import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/notifications/route';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, validateContentType, validateJsonSize } from '@/lib/api-utils';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/api-utils', () => ({
  checkRateLimit: jest.fn(),
  validateOrigin: jest.fn(),
  validateContentType: jest.fn(),
  validateJsonSize: jest.fn(),
  handleApiError: jest.fn((err) => ({
    status: err.statusCode || 500,
    json: async () => ({ error: err.message }),
  })),
  getClientIp: jest.fn(() => '127.0.0.1'),
  ErrorCodes: {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    BAD_REQUEST: 'BAD_REQUEST',
    RATE_LIMITED: 'RATE_LIMITED',
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public statusCode: number = 500) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

jest.mock('@/lib/social-utils', () => ({
  markNotificationsAsRead: jest.fn(),
}));

describe('Notifications PATCH Validation', () => {
  const mockUser = { id: 'user-123' };
  
  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: mockUser } }),
      },
    });
    (checkRateLimit as jest.Mock).mockResolvedValue(true);
  });

  it('should validate Content-Type', async () => {
    const req = new NextRequest('http://localhost/api/notifications', {
      method: 'PATCH',
      headers: { 'content-type': 'text/plain' },
    });

    (validateContentType as jest.Mock).mockImplementationOnce(() => {
      const { ApiError } = require('@/lib/api-utils');
      throw new ApiError('Invalid Content-Type', 415);
    });

    const response = await PATCH(req);
    expect(response.status).toBe(415);
    expect(validateContentType).toHaveBeenCalled();
  });

  it('should validate JSON size', async () => {
    const req = new NextRequest('http://localhost/api/notifications', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'content-length': '2000000' },
    });

    (validateJsonSize as jest.Mock).mockImplementationOnce(async () => {
      const { ApiError } = require('@/lib/api-utils');
      throw new ApiError('Payload too large', 413);
    });

    const response = await PATCH(req);
    expect(response.status).toBe(413);
    expect(validateJsonSize).toHaveBeenCalled();
  });

  it('should require markAll: true in body', async () => {
    const req = new NextRequest('http://localhost/api/notifications', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    });

    const response = await PATCH(req);
    expect(response.status).toBe(400);
  });
});
