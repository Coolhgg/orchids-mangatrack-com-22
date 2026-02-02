
import { prisma } from '../src/lib/prisma';
import { processCanonicalize } from '../src/workers/processors/canonicalize.processor';

async function fixSeries() {
  const seriesTitle = "Isekai wa Smartphone to Tomo ni";
  console.log(`Searching for series: "${seriesTitle}"`);

  const series = await prisma.series.findFirst({
    where: { title: seriesTitle }
  });

  if (!series) {
    console.error("Series not found in database");
    return;
  }

  console.log(`Found series: ${series.title} (ID: ${series.id}, MangaDex ID: ${series.mangadex_id})`);

  // Data from MangaDex for this series (based on my previous test search)
  // ID: 8bc61f6d-5b33-4c6b-bfdc-589daa4a4d78
  
  console.log("Triggering canonicalization with real MangaDex data...");
  
  const jobData = {
    title: series.title,
    source_name: 'mangadex',
    source_id: '8bc61f6d-5b33-4c6b-bfdc-589daa4a4d78',
    source_url: 'https://mangadex.org/title/8bc61f6d-5b33-4c6b-bfdc-589daa4a4d78',
    mangadex_id: '8bc61f6d-5b33-4c6b-bfdc-589daa4a4d78',
    description: "Touya Mochizuki was accidentally killed, and as an apology, God allows him to be reborn in a fantasy world and will grant him any one wish he desires. And so, Touya chooses to keep his smartphone in the next world. In his second chance at life, he befriends many important figures and comes across the world's secrets. He inherits the legacy of an ancient civilization and travels around nonchalantly while possessing powers that rival this world's kings.",
    cover_url: 'https://uploads.mangadex.org/covers/8bc61f6d-5b33-4c6b-bfdc-589daa4a4d78/299c8524-1f92-4113-9799-73f913d09e70.jpg',
    type: 'manga',
    status: 'ongoing',
    genres: ['Action', 'Adventure', 'Comedy', 'Fantasy', 'Harem', 'Romance'],
    tags: ['Isekai', 'Magic', 'Reincarnation'],
    content_rating: 'safe',
    confidence: 100
  };

  // Mock job object for BullMQ processor
  const mockJob = {
    id: 'manual_fix_job',
    data: jobData
  } as any;

  try {
    const result = await processCanonicalize(mockJob);
    console.log("Canonicalization complete:", result);
    
    // Verify update
    const updated = await prisma.series.findUnique({ where: { id: series.id } });
    console.log("Updated series state:");
    console.log(`- MangaDex ID: ${updated?.mangadex_id}`);
    console.log(`- Description: ${updated?.description?.slice(0, 50)}...`);
    console.log(`- Cover URL: ${updated?.cover_url}`);
  } catch (error) {
    console.error("Error during canonicalization:", error);
  } finally {
    await prisma.$disconnect();
  }
}

fixSeries();
