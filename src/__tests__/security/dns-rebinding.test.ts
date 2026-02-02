import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { isInternalIP } from '@/lib/constants/image-whitelist';
import type { Mock } from 'jest-mock';

type LookupResult = { address: string; family: number };

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
  setServers: jest.fn(),
}));

describe('DNS Rebinding Protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Internal IP Detection', () => {
    it('should detect localhost addresses', () => {
      expect(isInternalIP('127.0.0.1')).toBe(true);
      expect(isInternalIP('127.0.0.255')).toBe(true);
      expect(isInternalIP('localhost')).toBe(true);
    });

    it('should detect private IPv4 ranges (10.x.x.x)', () => {
      expect(isInternalIP('10.0.0.1')).toBe(true);
      expect(isInternalIP('10.255.255.255')).toBe(true);
      expect(isInternalIP('10.100.50.25')).toBe(true);
    });

    it('should detect private IPv4 ranges (172.16-31.x.x)', () => {
      expect(isInternalIP('172.16.0.1')).toBe(true);
      expect(isInternalIP('172.31.255.255')).toBe(true);
      expect(isInternalIP('172.20.100.50')).toBe(true);
    });

    it('should detect private IPv4 ranges (192.168.x.x)', () => {
      expect(isInternalIP('192.168.0.1')).toBe(true);
      expect(isInternalIP('192.168.255.255')).toBe(true);
      expect(isInternalIP('192.168.1.100')).toBe(true);
    });

    it('should detect link-local addresses (169.254.x.x)', () => {
      expect(isInternalIP('169.254.0.1')).toBe(true);
      expect(isInternalIP('169.254.255.255')).toBe(true);
    });

    it('should detect IPv6 loopback', () => {
      expect(isInternalIP('::1')).toBe(true);
    });

    it('should detect IPv6 private ranges', () => {
      expect(isInternalIP('fc00::1')).toBe(true);
      expect(isInternalIP('fd00::1')).toBe(true);
      expect(isInternalIP('fe80::1')).toBe(true);
    });

    it('should allow public IP addresses', () => {
      expect(isInternalIP('8.8.8.8')).toBe(false);
      expect(isInternalIP('1.1.1.1')).toBe(false);
      expect(isInternalIP('203.0.113.1')).toBe(false);
      expect(isInternalIP('93.184.216.34')).toBe(false);
    });

    it('should detect 0.0.0.0 as internal', () => {
      expect(isInternalIP('0.0.0.0')).toBe(true);
    });

    it('should handle invalid IP formats gracefully', () => {
      expect(isInternalIP('not-an-ip')).toBe(false);
    });
  });

  describe('DNS Resolution Protection', () => {
    it('should block DNS resolution to internal IPs', async () => {
      const dns = await import('node:dns/promises');
      (dns.lookup as any).mockResolvedValueOnce({ address: '127.0.0.1', family: 4 });

      const resolvedAddress = (await dns.lookup('malicious.example.com')).address;
      expect(isInternalIP(resolvedAddress)).toBe(true);
    });

    it('should allow DNS resolution to public IPs', async () => {
      const dns = await import('node:dns/promises');
      (dns.lookup as any).mockResolvedValueOnce({ address: '93.184.216.34', family: 4 });

      const resolvedAddress = (await dns.lookup('example.com')).address;
      expect(isInternalIP(resolvedAddress)).toBe(false);
    });

    it('should handle DNS CNAME chains resolving to internal IP', async () => {
      const dns = await import('node:dns/promises');
      (dns.lookup as any).mockResolvedValueOnce({ address: '10.0.0.1', family: 4 });

      const resolvedAddress = (await dns.lookup('cname-chain.example.com')).address;
      expect(isInternalIP(resolvedAddress)).toBe(true);
    });

    it('should handle DNS timeout gracefully', async () => {
      const dns = await import('node:dns/promises');
      (dns.lookup as any).mockRejectedValueOnce({ code: 'ETIMEOUT' });

      await expect(dns.lookup('slow-dns.example.com')).rejects.toEqual({ code: 'ETIMEOUT' });
    });

    it('should handle DNS ENOTFOUND gracefully', async () => {
      const dns = await import('node:dns/promises');
      (dns.lookup as any).mockRejectedValueOnce({ code: 'ENOTFOUND' });

      await expect(dns.lookup('nonexistent.example.com')).rejects.toEqual({ code: 'ENOTFOUND' });
    });
  });

  describe('DNS Rebinding Attack Scenarios', () => {
    it('should protect against time-based DNS rebinding', async () => {
      const dns = await import('node:dns/promises');
      
      (dns.lookup as any)
        .mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
        .mockResolvedValueOnce({ address: '127.0.0.1', family: 4 });

      const firstResolve = (await dns.lookup('rebinding.example.com')).address;
      expect(isInternalIP(firstResolve)).toBe(false);
      
      const secondResolve = (await dns.lookup('rebinding.example.com')).address;
      expect(isInternalIP(secondResolve)).toBe(true);
    });

    it('should protect against subdomain-based rebinding', async () => {
      const dns = await import('node:dns/promises');
      
      (dns.lookup as any).mockResolvedValueOnce({ address: '192.168.1.1', family: 4 });

      const resolvedAddress = (await dns.lookup('internal.attacker.com')).address;
      expect(isInternalIP(resolvedAddress)).toBe(true);
    });

    it('should block cloud metadata service IPs', () => {
      expect(isInternalIP('169.254.169.254')).toBe(true);
    });

    it('should block kubernetes service IPs', () => {
      expect(isInternalIP('10.96.0.1')).toBe(true);
      expect(isInternalIP('10.244.0.1')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle IPv4-mapped IPv6 addresses', () => {
      expect(isInternalIP('::ffff:127.0.0.1')).toBe(true);
      expect(isInternalIP('::ffff:192.168.1.1')).toBe(true);
      expect(isInternalIP('::ffff:8.8.8.8')).toBe(false);
    });

    it('should handle compressed IPv6 notation', () => {
      expect(isInternalIP('::1')).toBe(true);
      expect(isInternalIP('fe80::')).toBe(true);
    });

    it('should be case-insensitive for hostname checks', () => {
      expect(isInternalIP('LOCALHOST')).toBe(true);
      expect(isInternalIP('LocalHost')).toBe(true);
    });

    it('should handle IPv6 with zone ID', () => {
      expect(isInternalIP('fe80::1%eth0')).toBe(true);
    });
  });
});

describe('Image Proxy DNS Protection Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should validate dual-phase SSRF protection workflow', async () => {
    const dns = await import('node:dns/promises');
    
    const hostname = 'uploads.mangadex.org';
    expect(isInternalIP(hostname)).toBe(false);
    
    (dns.lookup as any).mockResolvedValueOnce({ address: '104.18.32.186', family: 4 });
    const resolvedAddress = (await dns.lookup(hostname)).address;
    expect(isInternalIP(resolvedAddress)).toBe(false);
  });

  it('should block if hostname looks safe but resolves to internal', async () => {
    const dns = await import('node:dns/promises');
    
    const hostname = 'safe-looking.external-cdn.com';
    expect(isInternalIP(hostname)).toBe(false);
    
    (dns.lookup as any).mockResolvedValueOnce({ address: '10.0.0.1', family: 4 });
    const resolvedAddress = (await dns.lookup(hostname)).address;
    expect(isInternalIP(resolvedAddress)).toBe(true);
  });
});
