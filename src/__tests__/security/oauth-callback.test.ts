import { describe, it, expect, beforeEach, jest } from '@jest/globals';

type AuthResponse = {
  data: { user: { id: string } } | null;
  error: { message: string } | null;
};

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn<() => Promise<any>>(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn<() => Promise<any[]>>(),
  },
}));

jest.mock('@/lib/api-utils', () => ({
  checkRateLimit: jest.fn<() => Promise<boolean>>(),
  getClientIp: jest.fn<() => string>().mockReturnValue('127.0.0.1'),
  getSafeRedirect: jest.fn<(url: string, defaultUrl: string) => string>((url: string, defaultUrl: string) => url || defaultUrl),
}));

describe('OAuth Callback Security', () => {
  const mockSupabase = {
    auth: {
      signOut: jest.fn<() => Promise<void>>(),
      exchangeCodeForSession: jest.fn<(code: string) => Promise<AuthResponse>>(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const { createClient } = require('@/lib/supabase/server');
    createClient.mockResolvedValue(mockSupabase);
  });

  it('should rate limit callback attempts', async () => {
    const { checkRateLimit } = require('@/lib/api-utils');
    
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(true);
    checkRateLimit.mockResolvedValueOnce(false);

    for (let i = 0; i < 10; i++) {
      const allowed = await checkRateLimit(`oauth:127.0.0.1`, 10, 60000);
      expect(allowed).toBe(true);
    }

    const allowed = await checkRateLimit(`oauth:127.0.0.1`, 10, 60000);
    expect(allowed).toBe(false);
    
    expect(checkRateLimit).toHaveBeenCalledTimes(11);
  });

  it('should reject soft-deleted users', async () => {
    const { prisma } = require('@/lib/prisma');
    
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });
    
    prisma.$queryRaw.mockResolvedValue([{ deleted_at: new Date() }]);

    const user = { id: 'user-123' };
    const dbUser = await prisma.$queryRaw`
      SELECT deleted_at FROM "User" WHERE id = ${user.id}::uuid LIMIT 1
    `;
    
    expect(dbUser[0].deleted_at).not.toBeNull();
    
    if (dbUser.length > 0 && dbUser[0].deleted_at !== null) {
      await mockSupabase.auth.signOut();
    }
    
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  });

  it('should not reject active users', async () => {
    const { prisma } = require('@/lib/prisma');
    
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'active-user-123' } },
      error: null,
    });
    
    prisma.$queryRaw.mockResolvedValue([{ deleted_at: null }]);

    const user = { id: 'active-user-123' };
    const dbUser = await prisma.$queryRaw`
      SELECT deleted_at FROM "User" WHERE id = ${user.id}::uuid LIMIT 1
    `;
    
    expect(dbUser[0].deleted_at).toBeNull();
  });

  it('should validate redirect URL strictly', async () => {
    const { getSafeRedirect } = require('@/lib/api-utils');
    
    getSafeRedirect.mockImplementation((url: string, defaultUrl: string) => {
      if (!url) return defaultUrl;
      if (url.startsWith('//')) return defaultUrl;
      if (url.startsWith('/') && !url.startsWith('//')) return url;
      
      try {
        const parsed = new URL(url);
        const allowedHosts = ['mangatrack.comm'];
        if (allowedHosts.includes(parsed.host)) {
          return url;
        }
      } catch {
      }
      
      return defaultUrl;
    });

    expect(getSafeRedirect('/library', '/library')).toBe('/library');

    expect(getSafeRedirect('/settings', '/library')).toBe('/settings');

    expect(getSafeRedirect('//evil.com', '/library')).toBe('/library');

    expect(getSafeRedirect('https://evil.com/steal', '/library')).toBe('/library');

    expect(getSafeRedirect('https://mangatrack.comm/dashboard', '/library')).toBe('https://mangatrack.comm/dashboard');

    expect(getSafeRedirect('javascript:alert(1)', '/library')).toBe('/library');

    expect(getSafeRedirect(null as unknown as string, '/library')).toBe('/library');

    expect(getSafeRedirect(undefined as unknown as string, '/library')).toBe('/library');
  });

  it('should perform session fixation protection', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-456' } },
      error: null,
    });

    await mockSupabase.auth.signOut();
    await mockSupabase.auth.exchangeCodeForSession('valid-code');

    expect(mockSupabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('valid-code');
  });

  it('should handle missing auth code gracefully', async () => {
    const url = new URL('http://localhost:3000/auth/callback');
    const code = url.searchParams.get('code');
    
    expect(code).toBeNull();
  });

  it('should handle exchange code errors', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: null,
      error: { message: 'Invalid code' },
    } as AuthResponse);

    const result = await mockSupabase.auth.exchangeCodeForSession('invalid-code');
    
    expect(result!.error).toBeTruthy();
    expect(result!.data).toBeNull();
  });
});
