import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"

describe("Multi-Source Integration Logic", () => {
  let testUserId: string
  let seriesId: string

  beforeAll(async () => {
    // Setup test user
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        username: `testuser_${Date.now()}`,
        password_hash: "hash",
      },
    })
    testUserId = user.id

    // Setup test series
    const series = await prisma.series.create({
      data: {
        title: "Test Multi-Source Series",
        type: "manga",
        status: "ongoing",
      },
    })
    seriesId = series.id
  })

  afterAll(async () => {
    // Cleanup
    await prisma.user.delete({ where: { id: testUserId } })
    await prisma.series.delete({ where: { id: seriesId } })
  })

  it("should correctly prioritize sources based on user preference", async () => {
    // 1. Create multiple sources for the series
    const source1 = await prisma.seriesSource.create({
      data: {
        series_id: seriesId,
        source_name: "mangadex",
        source_id: "md-1",
        source_url: "https://mangadex.org/title/md-1",
        trust_score: 0.9,
      },
    })

    const source2 = await prisma.seriesSource.create({
      data: {
        series_id: seriesId,
        source_name: "mangasee",
        source_id: "ms-1",
        source_url: "https://mangasee123.com/manga/ms-1",
        trust_score: 0.8,
      },
    })

    // 2. Set user source priority
    await prisma.userSourcePriority.createMany({
      data: [
        { user_id: testUserId, source_name: "mangasee", priority: 0 },
        { user_id: testUserId, source_name: "mangadex", priority: 1 },
      ],
    })

    // 3. Create a logical chapter with sources from both
    const chapter = await prisma.chapter.create({
      data: {
        series_id: seriesId,
        chapter_number: "1.0",
        chapter_slug: "1",
      },
    })

    await prisma.chapterSource.createMany({
      data: [
        {
          chapter_id: chapter.id,
          series_source_id: source1.id,
          source_name: "mangadex",
          source_chapter_url: "https://mangadex.org/chapter/md-c1",
          language: "en",
        },
        {
          chapter_id: chapter.id,
          series_source_id: source2.id,
          source_name: "mangasee",
          source_chapter_url: "https://mangasee123.com/chapter/ms-c1",
          language: "en",
        },
      ],
    })

    // 4. Verify sorting logic (mimicking the implementation in feed-updates or series-detail)
    const chapterWithSources = await prisma.chapter.findUnique({
      where: { id: chapter.id },
      include: {
        sources: {
          include: {
            series_source: true,
          },
        },
      },
    })

    const priorities = await prisma.userSourcePriority.findMany({
      where: { user_id: testUserId },
      orderBy: { priority: "asc" },
    })
    const priorityMap = new Map(priorities.map((p: any) => [p.source_name, p.priority]))

    const sortedSources = [...(chapterWithSources?.sources || [])].sort((a, b) => {
      const pA = priorityMap.has(a.series_source.source_name) ? priorityMap.get(a.series_source.source_name)! : 999
      const pB = priorityMap.has(b.series_source.source_name) ? priorityMap.get(b.series_source.source_name)! : 999
      
      if (pA !== pB) return pA - pB
      return Number(b.series_source.trust_score) - Number(a.series_source.trust_score)
    })

    expect(sortedSources[0].series_source.source_name).toBe("mangasee")
    expect(sortedSources[1].series_source.source_name).toBe("mangadex")
  })
})
