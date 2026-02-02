import { prisma } from "../../src/lib/prisma"

async function runTest() {
  console.log("🚀 Starting Availability Feed Verification Test...")

  try {
    // 1. Cleanup old test data
    await prisma.series.deleteMany({
      where: { title: { startsWith: "FEED_TEST_" } }
    })

    // 2. Setup Test Series
    const series = await prisma.series.create({
      data: {
        title: "FEED_TEST_Manga",
        type: "manga",
        catalog_tier: "B",
        status: "ongoing",
      }
    })

    const seriesSource = await prisma.seriesSource.create({
      data: {
        series_id: series.id,
        source_name: "SourceAlpha",
        source_id: "alpha-1",
        source_url: "https://alpha.com/manga",
      }
    })

    const seriesSource2 = await prisma.seriesSource.create({
      data: {
        series_id: series.id,
        source_name: "SourceBeta",
        source_id: "beta-1",
        source_url: "https://beta.com/manga",
      }
    })

    // 3. Create Chapters
    const ch10 = await prisma.chapter.create({
      data: {
        series_id: series.id,
        chapter_number: "10",
        chapter_slug: "10",
      }
    })

    const ch9 = await prisma.chapter.create({
      data: {
        series_id: series.id,
        chapter_number: "9",
        chapter_slug: "9",
      }
    })

    console.log("✅ Series and Chapters created.")

    // 4. Create Availability Events (ChapterSources)
    
    // T+0: Source Alpha releases Chapter 10
    const event1 = await prisma.chapterSource.create({
      data: {
        chapter_id: ch10.id,
        series_source_id: seriesSource.id,
        source_name: "SourceAlpha",
        source_chapter_url: "https://alpha.com/ch10",
        detected_at: new Date(Date.now() - 10000), // 10s ago
      }
    })

    // T+5s: Source Beta releases Chapter 10 (Same chapter, different source)
    const event2 = await prisma.chapterSource.create({
      data: {
        chapter_id: ch10.id,
        series_source_id: seriesSource2.id,
        source_name: "SourceBeta",
        source_chapter_url: "https://beta.com/ch10",
        detected_at: new Date(Date.now() - 5000), // 5s ago
      }
    })

    // T+10s: Source Alpha releases Chapter 9 (Older chapter released later - maybe a re-upload or late scraper match)
    const event3 = await prisma.chapterSource.create({
      data: {
        chapter_id: ch9.id,
        series_source_id: seriesSource.id,
        source_name: "SourceAlpha",
        source_chapter_url: "https://alpha.com/ch9",
        detected_at: new Date(), // Now
      }
    })

    console.log("✅ Availability events created.")

    // 5. Query the Availability Feed
    // We'll call the logic used in the API directly or via fetch if the server is running.
    // Since we are in the sandbox, we can use prisma.$queryRaw since that's what the API uses.
    
    const AVAILABILITY_FEED_SQL = `
      SELECT 
        cs.id as event_id,
        cs.detected_at as occurred_at,
        s.title as series_title,
        c.chapter_number,
        cs.source_name
      FROM chapter_sources cs
      JOIN chapters c ON c.id = cs.chapter_id
      JOIN series s ON s.id = c.series_id
      WHERE s.id = '${series.id}'
      ORDER BY cs.detected_at DESC
    `

    const feed = await prisma.$queryRawUnsafe(AVAILABILITY_FEED_SQL) as any[]

    console.log("\n📊 FEED SNAPSHOT (Expected 3 entries, sorted by time):")
    feed.forEach((entry, i) => {
      console.log(`${i + 1}. [${entry.occurred_at.toISOString()}] ${entry.series_title} Ch.${entry.chapter_number} (${entry.source_name})`)
    })

    // 6. Validations
    if (feed.length !== 3) {
      throw new Error(`Expected 3 entries, got ${feed.length}`)
    }

    // Verification 1: Ordering by occurred_at DESC
    const isOrdered = feed[0].occurred_at >= feed[1].occurred_at && feed[1].occurred_at >= feed[2].occurred_at
    if (!isOrdered) {
      throw new Error("Feed is NOT ordered by detected_at DESC")
    }
    console.log("✅ Validation: Feed is correctly ordered by time.")

    // Verification 2: Older chapter number (9) is first because it was detected latest
    if (feed[0].chapter_number !== "9") {
      throw new Error(`Expected first entry to be Ch.9 (detected latest), got Ch.${feed[0].chapter_number}`)
    }
    console.log("✅ Validation: Older chapter appearing later is correctly at the top.")

    // Verification 3: Multiple sources for Ch.10 exist separately
    const ch10Entries = feed.filter(f => f.chapter_number === "10")
    if (ch10Entries.length !== 2) {
      throw new Error(`Expected 2 entries for Ch.10, got ${ch10Entries.length}`)
    }
    const sources = ch10Entries.map(e => e.source_name)
    if (!sources.includes("SourceAlpha") || !sources.includes("SourceBeta")) {
      throw new Error(`Expected sources SourceAlpha and SourceBeta for Ch.10, got ${sources.join(", ")}`)
    }
    console.log("✅ Validation: Same chapter from different sources shown as separate events.")

    console.log("\n✨ ALL TESTS PASSED SUCCESSFULLY!")

  } catch (error) {
    console.error("\n❌ TEST FAILED:")
    console.error(error)
    process.exit(1)
  }
}

runTest()
