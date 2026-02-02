/**
 * @jest-environment node
 */
import { prisma } from "@/lib/prisma";
import { scheduleNotification, fetchPendingNotifications, markNotificationsAsSent } from "@/lib/notifications-timing";

describe("Notification Timing QA", () => {
  let testUserId: string;
  let seriesId: string;
  let chapterId: string;

  beforeAll(async () => {
    // 1. Setup User
    const user = await prisma.user.create({
      data: {
        email: `timing-test-${Date.now()}@example.com`,
        username: `timing_user_${Date.now()}`,
        password_hash: "hash",
        notification_settings: { email: true, push: true },
      },
    });
    testUserId = user.id;

    // 2. Setup Series
    const series = await prisma.series.create({
      data: {
        title: "Timing QA Series",
        type: "manga",
        status: "ongoing",
        catalog_tier: "A",
      },
    });
    seriesId = series.id;

    // 3. Setup Library Entry (Following)
    await prisma.libraryEntry.create({
      data: {
        user_id: testUserId,
        series_id: seriesId,
        source_url: `https://example.com/manga/test-${Date.now()}`,
        source_name: "test-source",
        notify_new_chapters: true,
      },
    });

    // 4. Setup Chapter
    const chapter = await prisma.chapter.create({
      data: {
        series_id: seriesId,
        chapter_number: "100",
      },
    });
    chapterId = chapter.id;
  });

  afterAll(async () => {
    // Cleanup with error handling to ensure other tests aren't affected
    try {
      await prisma.notificationQueue.deleteMany({ where: { user_id: testUserId } });
      await prisma.userChapterReadV2.deleteMany({ where: { user_id: testUserId } });
      await prisma.libraryEntry.deleteMany({ where: { user_id: testUserId } });
      await prisma.chapter.deleteMany({ where: { series_id: seriesId } });
      await prisma.series.delete({ where: { id: seriesId } });
      await prisma.user.delete({ where: { id: testUserId } });
    } catch (e) {
      console.warn("Cleanup failed, but tests completed:", e);
    }
  });

  it("QA 1 & 2: Should deduplicate multiple sources and apply delay", async () => {
    // Simulate Chapter appearing on Source A
    await scheduleNotification(chapterId, 10);
    
    // Simulate Same chapter appearing on Source B (immediately after)
    // This tests the UNIQUE constraint and ON CONFLICT DO NOTHING
    await scheduleNotification(chapterId, 10);

    // Verify only ONE entry in queue
    const queueEntries = await prisma.notificationQueue.findMany({
      where: { user_id: testUserId, chapter_id: chapterId }
    });
    expect(queueEntries.length).toBe(1);

    // Verify it's not ready yet (delay applied)
    const pending = await fetchPendingNotifications();
    const myPending = pending.filter(p => p.user_id === testUserId);
    expect(myPending.length).toBe(0);
  });

  it("QA 3: Should fetch notification after delay", async () => {
    // Manually backdate the notify_after to simulate passage of time
    await prisma.notificationQueue.update({
      where: { user_id_chapter_id: { user_id: testUserId, chapter_id: chapterId } },
      data: { notify_after: new Date(Date.now() - 1000) }
    });

    const pending = await fetchPendingNotifications();
    const myPending = pending.filter(p => p.user_id === testUserId);
    expect(myPending.length).toBe(1);
    expect(myPending[0].chapter_number).toBe("100");
    
    // Also verify series title is returned for the notification content
    expect(myPending[0].series_title).toBe("Timing QA Series");
  });

  it("QA 4: Should not notify if user reads chapter during delay", async () => {
    // Reset notification (mark as not sent)
    await prisma.notificationQueue.update({
      where: { user_id_chapter_id: { user_id: testUserId, chapter_id: chapterId } },
      data: { sent_at: null, notify_after: new Date(Date.now() - 1000) }
    });

    // Simulate User reading the chapter
    await prisma.userChapterReadV2.create({
      data: {
        user_id: testUserId,
        chapter_id: chapterId,
        is_read: true,
      }
    });

    // Fetch pending again
    const pending = await fetchPendingNotifications();
    const myPending = pending.filter(p => p.user_id === testUserId);
    
    // Should be EMPTY because of the JIT read check in the SQL (WHERE NOT EXISTS in fetchPendingNotifications)
    expect(myPending.length).toBe(0);
  });
});
