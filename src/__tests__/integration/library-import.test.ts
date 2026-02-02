import { NextRequest } from 'next/server';
import { POST } from '@/app/api/library/import/route';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';

// Mock Supabase and Prisma
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    libraryEntry: {
      findMany: jest.fn(),
    },
    importJob: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/queues', () => ({
  importQueue: {
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
  },
}));

describe('Library Import API Integration', () => {
  let mockUser = { id: 'test-user-uuid' };

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
    });
  });

  test('should validate import payload and deduplicate entries', async () => {
    const payload = {
      source: 'mangadex',
      entries: [
        { title: 'Test Manga 1', source_url: 'https://mangadex.org/title/1' },
        { title: 'Test Manga 1', source_url: 'https://mangadex.org/title/1' }, // Duplicate
        { title: 'Test Manga 2', source_url: 'https://mangadex.org/title/2' },
      ],
    };

    (prisma.libraryEntry.findMany as jest.Mock).mockResolvedValue([
      { source_url: 'https://mangadex.org/title/1' }, // Already in library
    ]);

    (prisma.importJob.create as jest.Mock).mockResolvedValue({ id: 'job-uuid' });

    const request = new NextRequest('http://localhost/api/library/import', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        'origin': 'http://localhost',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    
    expect(prisma.importJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        total_items: 1,
      }),
    }));
  });

  test('should reject invalid payloads', async () => {
    const payload = {
      source: 'mangadex',
      entries: [{ title: '', source_url: 'invalid-url' }], // Invalid
    };

    const request = new NextRequest('http://localhost/api/library/import', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        'origin': 'http://localhost',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBeDefined();
  });
});
