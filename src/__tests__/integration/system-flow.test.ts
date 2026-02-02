// @ts-nocheck - Integration test with complex mocks
/**
 * @jest-environment node
 */
import { prisma } from '@/lib/prisma';

// Mock BullMQ and related queues to avoid ESM/CJS issues in Jest
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
  })),
  Worker: jest.fn(),
}));

jest.mock('@/lib/queues', () => ({
  syncSourceQueue: { add: jest.fn() },
  refreshCoverQueue: { add: jest.fn() },
  seriesResolutionQueue: { add: jest.fn() },
}));

// Mock MangaDex API calls to avoid real network requests and fetch issues
jest.mock('@/lib/mangadex', () => ({
  getMangaById: jest.fn().mockImplementation(async (id) => {
    if (id === 'f9dbf403-4f98-4693-8686-63f274640030') {
      return {
        mangadex_id: id,
        title: 'Solo Leveling',
        status: 'completed',
        type: 'manga',
      };
    }
    return null;
  }),
  searchMangaDex: jest.fn().mockImplementation(async (title) => {
    if (title.includes('Solo Leveling')) {
      return [{
        mangadex_id: 'f9dbf403-4f98-4693-8686-63f274640030',
        title: 'Solo Leveling',
        status: 'completed',
        type: 'manga',
      }];
    }
    return [];
  }),
}));

// Mock localStorage for SyncOutbox (it's a client-side utility)
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });
Object.defineProperty(global, 'window', { value: { dispatchEvent: jest.fn() }, writable: true });
// @ts-expect-error - Event constructor not present in Node.js global but used in client-side sync outbox
global.Event = class Event {};

// Now import the processor after mocks
import { processResolution } from '@/workers/processors/resolution.processor';
import { SyncOutbox } from '@/lib/sync/outbox';
import { isIpInRange } from '@/lib/api-utils';

describe('System Flow Integration Tests', () => {
  let testUserId: string;

  beforeAll(async () => {
    // Setup test user
    const user = await prisma.user.upsert({
      where: { email: 'qa-tester@example.com' },
      update: {},
      create: {
        email: 'qa-tester@example.com',
        username: 'qatester',
        password_hash: 'test',
      }
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.libraryEntry.deleteMany({ where: { user_id: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
  });

  describe('Resolution Worker', () => {
    test('Should merge duplicate library entries and retain highest progress', async () => {
      // 1. Create two entries that will resolve to the same series (MangaDex UUID)
      const mdUuid = 'f9dbf403-4f98-4693-8686-63f274640030'; // Solo Leveling
      
      const entry1 = await prisma.libraryEntry.create({
        data: {
          user_id: testUserId,
          source_url: `https://mangadex.org/title/${mdUuid}/solo-leveling`,
          source_name: 'mangadex',
          imported_title: 'Solo Leveling',
          last_read_chapter: 10,
        }
      });

      const entry2 = await prisma.libraryEntry.create({
        data: {
          user_id: testUserId,
          source_url: `https://mangadex.org/manga/${mdUuid}`,
          source_name: 'mangadex',
          imported_title: 'Solo Leveling (Dup)',
          last_read_chapter: 25,
        }
      });

      // 2. Process resolution for both
      // @ts-expect-error - Job type is complex and mocked here
      await processResolution({ data: { 
        libraryEntryId: entry1.id,
        source_url: entry1.source_url,
        title: entry1.imported_title
      } });
      
      // @ts-expect-error - Job type is complex and mocked here
      await processResolution({ data: { 
        libraryEntryId: entry2.id,
        source_url: entry2.source_url,
        title: entry2.imported_title
      } });

      // 3. Verify: Only one entry should remain, with the highest chapter
      const finalEntries = await prisma.libraryEntry.findMany({
        where: { user_id: testUserId }
      });

      expect(finalEntries).toHaveLength(1);
      expect(Number(finalEntries[0].last_read_chapter)).toBe(25);
    }, 10000);
  });

  describe('Sync Outbox Deduplication', () => {
    test('Should deduplicate LIBRARY_ADD actions in the sync outbox', async () => {
      SyncOutbox.clear();
      
      SyncOutbox.enqueue('LIBRARY_ADD', { seriesId: 'test-1', status: 'reading' });
      SyncOutbox.enqueue('LIBRARY_ADD', { seriesId: 'test-1', status: 'completed' });
      SyncOutbox.enqueue('LIBRARY_ADD', { seriesId: 'test-2', status: 'reading' });

      const actions = SyncOutbox.getActions();
      
      // Should have 2 actions: test-1 (latest state) and test-2
      expect(actions).toHaveLength(2);
      const test1Action = actions.find(a => (a.payload as any).seriesId === 'test-1');
      expect((test1Action?.payload as any).status).toBe('completed');
    });

    test('Should deduplicate CHAPTER_READ actions in the sync outbox', async () => {
      SyncOutbox.clear();
      
      SyncOutbox.enqueue('CHAPTER_READ', { seriesId: 'test-1', chapter: 1 });
      SyncOutbox.enqueue('CHAPTER_READ', { seriesId: 'test-1', chapter: 2 });
      SyncOutbox.enqueue('CHAPTER_READ', { seriesId: 'test-1', chapter: 1.5 });

      const actions = SyncOutbox.getActions();
      
      // Should have 1 action for test-1 with chapter 2 (highest)
      expect(actions).toHaveLength(1);
      expect((actions[0].payload as any).chapter).toBe(2);
    });
  });

  describe('Security: CIDR Filtering', () => {
    test('isIpInRange correctly validates IPv4 CIDR ranges', () => {
      expect(isIpInRange('127.0.0.1', '127.0.0.1/32')).toBe(true);
      expect(isIpInRange('127.0.0.2', '127.0.0.1/32')).toBe(false);
      expect(isIpInRange('192.168.1.50', '192.168.1.0/24')).toBe(true);
      expect(isIpInRange('192.168.2.1', '192.168.1.0/24')).toBe(false);
      expect(isIpInRange('10.0.0.1', '10.0.0.0/8')).toBe(true);
      expect(isIpInRange('172.16.0.1', '10.0.0.0/8')).toBe(false);
    });
  });
});
