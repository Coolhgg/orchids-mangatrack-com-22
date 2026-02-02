import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis, waitForRedis } from '@/lib/redis';
import { POST, GET } from '@/app/api/dmca/route';
import { ApiError, ErrorCodes } from '@/lib/api-utils';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn((cb) => cb(prisma)),
    chapterLink: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    dmcaRequest: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    linkSubmissionAudit: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 3600000]]),
    })),
  },
  waitForRedis: jest.fn().mockResolvedValue(true),
  REDIS_KEY_PREFIX: 'test:',
}));

describe('DMCA API Integration Tests', () => {
  const mockDmcaRequest = {
    requester_name: 'Test Submitter',
    requester_contact: 'test@example.com',
    work_title: 'Copyrighted Manga Title',
    target_url: 'https://example.com/chapter/123',
    claim_details: 'This is a detailed claim about copyright infringement that exceeds twenty characters.',
    good_faith_statement: true,
    accuracy_statement: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/dmca', () => {
    it('should successfully submit a DMCA request when no matching link is found', async () => {
      (prisma.chapterLink.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.dmcaRequest.create as jest.Mock).mockResolvedValue({ id: 'dmca-123' });

      const req = new NextRequest('http://localhost/api/dmca', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mockDmcaRequest),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.link_removed).toBe(false);
      expect(prisma.dmcaRequest.create).toHaveBeenCalled();
      expect(prisma.chapterLink.update).not.toHaveBeenCalled();
    });

    it('should successfully submit a DMCA request and soft-delete a matching link', async () => {
      const mockLink = {
        id: 'link-123',
        series_id: 'series-123',
        url: 'https://example.com/chapter/123',
        submitted_by: 'user-123',
      };

      (prisma.chapterLink.findFirst as jest.Mock).mockResolvedValue(mockLink);
      (prisma.dmcaRequest.create as jest.Mock).mockResolvedValue({ id: 'dmca-123' });

      const req = new NextRequest('http://localhost/api/dmca', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mockDmcaRequest),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.link_removed).toBe(true);
      
      // Verify soft delete
      expect(prisma.chapterLink.update).toHaveBeenCalledWith({
        where: { id: 'link-123' },
        data: expect.objectContaining({
          status: 'removed',
          deleted_at: expect.any(Date),
        }),
      });

      // Verify audit logging
      expect(prisma.linkSubmissionAudit.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          event: 'dmca_submission',
          status: 'success',
        }),
      }));
    });

    it('should return structured validation errors for invalid input', async () => {
      const invalidRequest = {
        ...mockDmcaRequest,
        requester_contact: 'invalid-email',
        claim_details: 'too short',
      };

      const req = new NextRequest('http://localhost/api/dmca', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(invalidRequest),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(data.details).toBeDefined();
      expect(data.details.requester_contact).toContain('Valid email address required');
      expect(data.details.claim_details).toContain('Please provide detailed claim information (min 20 characters)');
    });

    it('should enforce rate limits', async () => {
      (redis.multi as jest.Mock).mockReturnValue({
        incr: jest.fn().mockReturnThis(),
        pttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 10], [null, 3600000]]), // 10 requests (limit is 5)
      });

      const req = new NextRequest('http://localhost/api/dmca', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mockDmcaRequest),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.code).toBe(ErrorCodes.RATE_LIMITED);
    });
  });

  describe('GET /api/dmca', () => {
    it('should return request status when valid ID and email provided', async () => {
      const mockRequest = {
        id: 'dmca-123',
        status: 'pending',
        work_title: 'Test Title',
      };

      (prisma.dmcaRequest.findFirst as jest.Mock).mockResolvedValue(mockRequest);

      const req = new NextRequest('http://localhost/api/dmca?id=dmca-123&email=test@example.com');
      const response = await GET(req);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.request).toBeDefined();
      expect(data.request.id).toBe('dmca-123');
    });

    it('should return 404 when request not found', async () => {
      (prisma.dmcaRequest.findFirst as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/dmca?id=nonexistent&email=test@example.com');
      const response = await GET(req);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });
});
