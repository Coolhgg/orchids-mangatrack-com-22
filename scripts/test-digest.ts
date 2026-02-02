import { prisma } from '../src/lib/prisma';
import { processNotificationDigest } from '../src/workers/processors/notification-digest.processor';

async function testDigest() {
  console.log('--- Testing Notification Digest ---');
  
  // 1. Find a test user
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user found');
    return;
  }
  
  // 2. Set user to 'short' digest
  await prisma.user.update({
    where: { id: user.id },
    data: { notification_digest: 'short' }
  });
  
  // 3. Find a test series
  const series = await prisma.series.findFirst();
  if (!series) {
    console.log('No series found');
    return;
  }
  
  console.log(`User: ${user.username}, Series: ${series.title}`);
  
  // 4. Insert dummy data into buffer
  // We insert data with created_at 20 mins ago to trigger the 'short' digest
  const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
  
  await prisma.notificationDigestBuffer.create({
    data: {
      user_id: user.id,
      series_id: series.id,
      chapter_number: "101",
      source_names: ['MangaDex', 'MangaPark'],
      created_at: twentyMinsAgo,
    }
  });
  
  console.log('Inserted buffered notification');
  
  // 5. Run the processor manually
  const result = await processNotificationDigest({ queue: { add: async () => {} } } as any);
  
  console.log('Processor Result:', result);
  
  // 6. Check if notification was created
  const latestNotification = await prisma.notification.findFirst({
    where: { user_id: user.id, type: 'DIGEST' },
    orderBy: { created_at: 'desc' }
  });
  
  if (latestNotification) {
    console.log('SUCCESS: Digest notification created!');
    console.log('Title:', latestNotification.title);
    console.log('Message:', latestNotification.message);
  } else {
    console.log('FAIL: No digest notification found');
  }
  
  // 7. Cleanup
  await prisma.notificationDigestBuffer.deleteMany({ where: { user_id: user.id } });
  // await prisma.notification.delete({ where: { id: latestNotification?.id } });
}

testDigest()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
