import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Testing library fetch...');
  try {
    const entries = await prisma.libraryEntry.findMany({
      take: 5,
    });
    console.log(`Successfully fetched ${entries.length} entries.`);
    console.log('Sample entry:', JSON.stringify(entries[0], null, 2));
    
    // Check for any potential issues in the fetched data
    entries.forEach((entry, index) => {
      if (entry.source_url === null || entry.source_url === undefined) {
        throw new Error(`Entry ${index} has null source_url`);
      }
      if (!['pending', 'enriched', 'failed'].includes(entry.metadata_status)) {
        throw new Error(`Entry ${index} has invalid metadata_status: ${entry.metadata_status}`);
      }
    });
    
    console.log('Verification successful!');
  } catch (error) {
    console.error('Verification failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
