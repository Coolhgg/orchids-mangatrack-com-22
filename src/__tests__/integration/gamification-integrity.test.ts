/** @jest-environment node */
import { prisma } from '@/lib/prisma';
import { XP_SERIES_COMPLETED } from '@/lib/gamification/xp';
import { PATCH, DELETE } from '@/app/api/library/[id]/route';
import { POST } from '@/app/api/library/route';
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server');
jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: jest.fn((data, init) => ({
      json: async () => data,
      status: init?.status || 200,
    })),
  },
}));
jest.mock('@/lib/api-utils', () => ({
  ...jest.requireActual('@/lib/api-utils'),
  validateOrigin: jest.fn(),
  checkRateLimit: jest.fn(() => true),
  validateContentType: jest.fn(),
  validateJsonSize: jest.fn(),
  getClientIp: jest.fn(() => '127.0.0.1'),
  handleApiError: jest.fn((err) => {
    console.error('API Error in test:', err);
    return { json: async () => ({ error: err.message }), status: err.status || 500 };
  }),
}));

jest.setTimeout(30000); // Increase timeout for DB operations

describe('Gamification Integrity Integration', () => {
  let testUser: any;
  let testSeries: any;

  beforeAll(async () => {
    // Setup test user
    testUser = await prisma.user.create({
      data: {
        email: `test-qa-${Date.now()}@example.com`,
        username: `testqa_${Date.now()}`,
        xp: 0,
        level: 1,
      },
    });

    // Setup test series
    testSeries = await prisma.series.create({
      data: {
        title: 'QA Test Series',
        type: 'manga',
        sources: {
          create: {
            source_name: 'MangaDex',
            source_id: `qa-${Date.now()}`,
            source_url: `https://mangadex.org/title/qa-${Date.now()}`,
          },
        },
      },
      include: { sources: true },
    });

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: testUser } }),
      },
    });
  });

  afterAll(async () => {
    await prisma.activity.deleteMany({ where: { user_id: testUser.id } });
    await prisma.libraryEntry.deleteMany({ where: { user_id: testUser.id } });
    await prisma.seriesSource.deleteMany({ where: { series_id: testSeries.id } });
    await prisma.series.delete({ where: { id: testSeries.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('awards XP only once for completing a series (BUG-102)', async () => {
    // 1. Add to library
    const addReq = {
      method: 'POST',
      json: async () => ({ seriesId: testSeries.id, status: 'reading' }),
      headers: { get: (name: string) => name === 'content-type' ? 'application/json' : null },
    } as any;
    const addRes = await POST(addReq);
    const entry = await addRes.json();

    // 2. Mark as completed -> Should award XP
    const completeReq = {
      method: 'PATCH',
      json: async () => ({ status: 'completed' }),
      headers: { get: (name: string) => name === 'content-type' ? 'application/json' : null },
    } as any;
    await PATCH(completeReq, { params: Promise.resolve({ id: entry.id }) });

    const userAfterFirst = await prisma.user.findUnique({
      where: { id: testUser.id },
      select: { xp: true },
    });
    expect(userAfterFirst?.xp).toBe(XP_SERIES_COMPLETED);

    // 3. Mark as reading then completed again -> Should NOT award XP
    const readingReq = {
      method: 'PATCH',
      json: async () => ({ status: 'reading' }),
      headers: { get: (name: string) => name === 'content-type' ? 'application/json' : null },
    } as any;
    await PATCH(readingReq, { params: Promise.resolve({ id: entry.id }) });

    const completeReq2 = {
      method: 'PATCH',
      json: async () => ({ status: 'completed' }),
      headers: { get: (name: string) => name === 'content-type' ? 'application/json' : null },
    } as any;
    await PATCH(completeReq2, { params: Promise.resolve({ id: entry.id }) });

    const userAfterSecond = await prisma.user.findUnique({
      where: { id: testUser.id },
      select: { xp: true },
    });
    expect(userAfterSecond?.xp).toBe(XP_SERIES_COMPLETED); // Still 100, not 200
  });

  it('maintains XP integrity across soft-deletion and re-addition (BUG-101/102)', async () => {
    // 1. Get current entry
    const entry = await prisma.libraryEntry.findFirst({
      where: { user_id: testUser.id, series_id: testSeries.id },
    });

    // 2. Delete entry (Soft Delete BUG-101)
    const deleteReq = {
      method: 'DELETE',
      headers: { get: () => null },
    } as any;
    await DELETE(deleteReq, { params: Promise.resolve({ id: entry?.id as string }) });

    const softDeleted = await prisma.libraryEntry.findUnique({
      where: { id: entry?.id },
    });
    expect(softDeleted?.deleted_at).not.toBeNull();

    // 3. Re-add entry
    const reAddReq = {
      method: 'POST',
      json: async () => ({ seriesId: testSeries.id, status: 'completed' }),
      headers: { get: (name: string) => name === 'content-type' ? 'application/json' : null },
    } as any;
    await POST(reAddReq);

    const userAfterReAdd = await prisma.user.findUnique({
      where: { id: testUser.id },
      select: { xp: true },
    });
    
    // XP should still be 100 because activity log exists
    expect(userAfterReAdd?.xp).toBe(XP_SERIES_COMPLETED);
    
    // Verify restored
    const restored = await prisma.libraryEntry.findUnique({
      where: { id: entry?.id },
    });
    expect(restored?.deleted_at).toBeNull();
  });
});
