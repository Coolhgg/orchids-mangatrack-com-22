import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/notifications/route';
import { ApiError } from '@/lib/api-utils';

// Mock Supabase
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'test-user-id' } } })),
    },
  })),
}));

// Mock Social Utils
jest.mock('@/lib/social-utils', () => ({
  markNotificationsAsRead: jest.fn(() => Promise.resolve()),
}));

describe('Notifications API Security Integration', () => {
  const createRequest = (headers: Record<string, string> = {}, body: any = { markAll: true }) => {
    return new NextRequest('http://localhost/api/notifications', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'host': 'localhost',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  };

  it('should reject requests with missing content-type', async () => {
    const req = createRequest();
    req.headers.delete('content-type');
    
    const response = await PATCH(req);
    const data = await response.json();
    
    expect(response.status).toBe(415);
    expect(data.error).toContain('Invalid Content-Type');
  });

  it('should reject requests with invalid content-type', async () => {
    const req = createRequest({ 'content-type': 'text/plain' });
    
    const response = await PATCH(req);
    const data = await response.json();
    
    expect(response.status).toBe(415);
    expect(data.error).toContain('Invalid Content-Type');
  });

  it('should reject requests with oversized JSON body', async () => {
    // 1MB + 1 byte
    const largeBody = 'a'.repeat(1024 * 1024 + 1);
    const req = new NextRequest('http://localhost/api/notifications', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'content-length': (1024 * 1024 + 1).toString(),
        'host': 'localhost',
      },
      body: JSON.stringify({ data: largeBody }),
    });
    
    const response = await PATCH(req);
    const data = await response.json();
    
    expect(response.status).toBe(413);
    expect(data.error).toContain('Payload too large');
  });

  it('should reject requests with invalid JSON body format', async () => {
    const req = createRequest({}, { invalidField: true });
    
    const response = await PATCH(req);
    const data = await response.json();
    
    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid request');
  });

  it('should accept valid requests', async () => {
    const req = createRequest();
    
    const response = await PATCH(req);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
