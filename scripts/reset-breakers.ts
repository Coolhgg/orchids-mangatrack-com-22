import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting circuit breaker reset...');

  try {
    // 1. Reset all series sources that are in COLD state or have failures
    const result = await prisma.seriesSource.updateMany({
      where: {
        OR: [
          { failure_count: { gt: 0 } },
          { sync_priority: 'COLD' }
        ]
      },
      data: {
        failure_count: 0,
        sync_priority: 'NORMAL',
        next_check_at: new Date(), // Re-queue for immediate check
      }
    });

    console.log(`✅ Reset ${result.count} series sources.`);
    
    // 2. Also ensure any series that might have been "stuck" due to sync_priority are bumped
    // This is a broader safety net
    const stuckResult = await prisma.seriesSource.updateMany({
      where: {
        next_check_at: {
          lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Older than 24h
        },
        sync_priority: 'COLD'
      },
      data: {
        sync_priority: 'NORMAL',
        next_check_at: new Date(),
      }
    });

    if (stuckResult.count > 0) {
        console.log(`✅ Bumped ${stuckResult.count} stuck COLD sources.`);
    }

    console.log('✨ Circuit breaker reset complete!');
  } catch (error) {
    console.error('❌ Failed to reset circuit breakers:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
