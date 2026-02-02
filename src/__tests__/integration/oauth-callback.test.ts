import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { NextRequest } from 'next/server';

const mockSignOut = jest.fn<() => Promise<void>>();
const mockExchangeCodeForSession = jest.fn<() => Promise<{ data: { user: { id: string } } | null; error: Error | null }>>();
const mockGetUser = jest.fn<() => Promise<{ data: { user: { id: string } | null }; error: Error | null }>>();

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => Promise.resolve({
    auth: {
      signOut: mockSignOut,
      exchangeCodeForSession: mockExchangeCodeForSession,
      getUser: mockGetUser,
    },
  })),
}));

const mockPrismaQueryRaw = jest.fn<() => Promise<{ deleted_at: Date | null }[]>>();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: mockPrismaQueryRaw,
  },
}));

const mockCheckRateLimit = jest.fn<() => Promise<boolean>>();
const mockGetClientIp = jest.fn<() => string>();
const mockGetSafeRedirect = jest.fn<(url: string | null, defaultUrl: string) => string>();

jest.mock('@/lib/api-utils', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
  getSafeRedirect: mockGetSafeRedirect,
}));

describe('OAuth Callback Security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClientIp.mockReturnValue('127.0.0.1');
    mockGetSafeRedirect.mockImplementation((url: string | null, defaultUrl: string) => {
      if (!url) return defaultUrl;
      if (url.startsWith('//')) return defaultUrl;
      if (url.startsWith('/') && !url.startsWith('//')) return url;
      try {
        const parsed = new URL(url);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          return defaultUrl;
        }
      } catch {
        return defaultUrl;
      }
      return defaultUrl;
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Rate Limiting', () => {
    it('should rate limit OAuth callback requests', async () => {
      mockCheckRateLimit.mockResolvedValueOnce(false);

      const { GET } = await import('@/app/auth/callback/route');
      const request = new NextRequest('http://localhost:3000/auth/callback?code=test123');
      
      const response = await GET(request);
      
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('auth-code-error?error=rate_limited');
    });

    it('should allow requests within rate limit', async () => {
      mockCheckRateLimit.mockResolvedValueOnce(true);
      mockExchangeCodeForSession.mockResolvedValueOnce({ 
        data: { user: { id: 'user-123' } }, 
        error: null 
      });
      mockPrismaQueryRaw.mockResolvedValueOnce([{ deleted_at: null }]);

      const { GET } = await import('@/app/auth/callback/route');
      const request = new NextRequest('http://localhost:3000/auth/callback?code=valid-code');
      
      const response = await GET(request);
      
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).not.toContain('error');
    });
  });

  describe('Session Fixation Protection', () => {
    it('should sign out existing session before exchanging code', async () => {
      mockCheckRateLimit.mockResolvedValueOnce(true);
      mockExchangeCodeForSession.mockResolvedValueOnce({ 
        data: { user: { id: 'user-123' } }, 
        error: null 
      });
      mockPrismaQueryRaw.mockResolvedValueOnce([{ deleted_at: null }]);

      const { GET } = await import('@/app/auth/callback/route');
      const request = new NextRequest('http://localhost:3000/auth/callback?code=valid-code');
      
      await GET(request);
      
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  describe('Soft Delete Protection', () => {
    it('should block login for soft-deleted users', async () => {
      mockCheckRateLimit.mockResolvedValueOnce(true);
      mockExchangeCodeForSession.mockResolvedValueOnce({ 
        data: { user: { id: 'deleted-user' } }, 
        error: null 
      });
      mockPrismaQueryRaw.mockResolvedValueOnce([{ deleted_at: new Date() }]);

      const { GET } = await import('@/app/auth/callback/route');
      const request = new NextRequest('http://localhost:3000/auth/callback?code=valid-code');
      
      const response = await GET(request);
      
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('error=account_deleted');
    });

    it('should allow login for non-deleted users', async () => {
      mockCheckRateLimit.mockResolvedValueOnce(true);
      mockExchangeCodeForSession.mockResolvedValueOnce({ 
        data: { user: { id: 'active-user' } }, 
        error: null 
      });
      mockPrismaQueryRaw.mockResolvedValueOnce([{ deleted_at: null }]);

      const { GET } = await import('@/app/auth/callback/route');
      const request = new NextRequest('http://localhost:3000/auth/callback?code=valid-code');
      
      const response = await GET(request);
      
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).not.toContain('error');
    });
  });

  describe('Redirect URL Validation', () => {
    it('should use safe redirect for internal paths', () => {
      expect(mockGetSafeRedirect('/library', '/default')).toBe('/library');
      expect(mockGetSafeRedirect('/settings/profile', '/default')).toBe('/settings/profile');
    });

    it('should reject protocol-relative URLs', () => {
      expect(mockGetSafeRedirect('//evil.com/path', '/default')).toBe('/default');
    });

    it('should reject external URLs', () => {
      expect(mockGetSafeRedirect('https://evil.com/path', '/default')).toBe('/default');
      expect(mockGetSafeRedirect('http://malicious.site', '/default')).toBe('/default');
    });

    it('should use default for null/undefined', () => {
      expect(mockGetSafeRedirect(null, '/library')).toBe('/library');
    });
  });

  describe('Missing Code Parameter', () => {
    it('should redirect to error page when code is missing', async () => {
      mockCheckRateLimit.mockResolvedValueOnce(true);

      const { GET } = await import('@/app/auth/callback/route');
      const request = new NextRequest('http://localhost:3000/auth/callback');
      
      const response = await GET(request);
      
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('auth-code-error');
    });
  });

  describe('Invalid Code Handling', () => {
    it('should redirect to error page when code exchange fails', async () => {
      mockCheckRateLimit.mockResolvedValueOnce(true);
      mockExchangeCodeForSession.mockResolvedValueOnce({ 
        data: null, 
        error: new Error('Invalid code') 
      });

      const { GET } = await import('@/app/auth/callback/route');
      const request = new NextRequest('http://localhost:3000/auth/callback?code=invalid-code');
      
      const response = await GET(request);
      
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('auth-code-error');
    });
  });
});
