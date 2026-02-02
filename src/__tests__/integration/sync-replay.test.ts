import { POST } from '@/app/api/sync/replay/route';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    libraryEntry: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    chapter: {
      findUnique: jest.fn(),
    },
    $executeRaw: jest.fn(),
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

describe('Sync Replay API', () => {
  const mockUser = { id: 'user-123' };
  const mockDeviceId = 'device-abc';

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: mockUser } }),
      },
    });
  });

  const createReq = (body: any) => {
    return new NextRequest('http://localhost/api/sync/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  it('should process CHAPTER_READ with LWW logic', async () => {
    (prisma.libraryEntry.findUnique as jest.Mock).mockResolvedValue({ series_id: 'series-1' });
    (prisma.chapter.findUnique as jest.Mock).mockResolvedValue({ id: 'chapter-1' });
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

    const actions = [
      {
        id: 'action-1',
        type: 'CHAPTER_READ',
        payload: { entryId: 'entry-1', chapterNumber: "1", sourceId: 'source-1', isRead: true },
        timestamp: Date.now(),
        deviceId: mockDeviceId,
      },
    ];

    const req = createReq({ actions });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results[0].status).toBe('success');
    expect(prisma.$executeRaw).toHaveBeenCalled();
    // Verify SQL contains LWW check
    const calls = (prisma.$executeRaw as jest.Mock).mock.calls[0];
    const sqlParts = calls[0];
    const sql = Array.isArray(sqlParts) ? sqlParts.join('') : sqlParts;
    expect(sql).toContain('EXCLUDED."updated_at" > "user_chapter_reads_v2"."updated_at"');
  });

  it('should process LIBRARY_UPDATE with LWW logic', async () => {
    (prisma.libraryEntry.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const timestamp = Date.now();
    const actions = [
      {
        id: 'action-2',
        type: 'LIBRARY_UPDATE',
        payload: { entryId: 'entry-1', status: 'completed', rating: 5 },
        timestamp,
        deviceId: mockDeviceId,
      },
    ];

    const req = createReq({ actions });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results[0].applied).toBe(true);
    expect(prisma.libraryEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        updated_at: { lt: new Date(timestamp) }
      })
    }));
  });

  it('should handle missing library entries gracefully', async () => {
    (prisma.libraryEntry.findUnique as jest.Mock).mockResolvedValue(null);

    const actions = [
      {
        id: 'action-3',
        type: 'CHAPTER_READ',
        payload: { entryId: 'invalid-entry', chapterNumber: "1" },
        timestamp: Date.now(),
        deviceId: mockDeviceId,
      },
    ];

    const req = createReq({ actions });
    const res = await POST(req);
    const data = await res.json();

    expect(data.results[0].status).toBe('error');
    expect(data.results[0].message).toContain('not found');
  });

  it('should handle batch processing in a transaction', async () => {
    (prisma.libraryEntry.findUnique as jest.Mock).mockResolvedValue({ series_id: 'series-1' });
    (prisma.chapter.findUnique as jest.Mock).mockResolvedValue({ id: 'chapter-1' });
    (prisma.libraryEntry.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const actions = [
      {
        id: 'a1',
        type: 'CHAPTER_READ',
        payload: { entryId: 'e1', chapterNumber: "1" },
        timestamp: Date.now(),
        deviceId: 'd1',
      },
      {
        id: 'a2',
        type: 'LIBRARY_UPDATE',
        payload: { entryId: 'e1', status: 'reading' },
        timestamp: Date.now(),
        deviceId: 'd1',
      }
    ];

    const req = createReq({ actions });
    await POST(req);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.libraryEntry.updateMany).toHaveBeenCalled();
  });
});
