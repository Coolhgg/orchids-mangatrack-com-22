import {
  sanitizeInput,
  escapeILikePattern,
  validateUUID,
  getSafeRedirect,
  validateEmail,
  validateUsername,
  ApiError,
} from '@/lib/api-utils'

describe('Security Tests - Input Validation', () => {
  describe('XSS Prevention', () => {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<body onload=alert(1)>',
      '<iframe src="javascript:alert(1)">',
      '<a href="javascript:alert(1)">click</a>',
      '<div onclick="alert(1)">click me</div>',
      '<input onfocus=alert(1) autofocus>',
      '<marquee onstart=alert(1)>',
      '<video><source onerror="alert(1)">',
      '<math><mtext><option><FAKEMGLYPH><select><option></select><script>alert(1)</script>',
      '"><script>alert(String.fromCharCode(88,83,83))</script>',
      '<IMG """><SCRIPT>alert("XSS")</SCRIPT>">',
      '<IMG SRC=javascript:alert(String.fromCharCode(88,83,83))>',
      '<IMG SRC=# onmouseover="alert(\'xss\')">',
      '<IMG SRC= onmouseover="alert(\'xss\')">',
      '<IMG onmouseover="alert(\'xss\')">',
      '<IMG SRC=javascript:alert(&quot;XSS&quot;)>',
      '<IMG SRC=`javascript:alert("RSnake says, \'XSS\'")`>',
      '\\x3cscript\\x3ealert(1)\\x3c/script\\x3e',
      '<object data="javascript:alert(1)">',
      '<embed src="javascript:alert(1)">',
      '<form action="javascript:alert(1)"><input type=submit>',
      '<isindex action=javascript:alert(1) type=submit>',
      '<input type="image" src="javascript:alert(1);">',
      '<link rel="stylesheet" href="javascript:alert(1)">',
      '<style>body{background:url("javascript:alert(1)")}</style>',
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
      '<base href="javascript:alert(1)//">',
    ]

    it.each(xssPayloads)('should sanitize XSS payload: %s', (payload) => {
      const sanitized = sanitizeInput(payload)
      expect(sanitized).not.toContain('<script')
      expect(sanitized).not.toContain('javascript:')
      expect(sanitized).not.toContain('onerror=')
      expect(sanitized).not.toContain('onclick=')
      expect(sanitized).not.toContain('onload=')
      expect(sanitized).not.toContain('onmouseover=')
      expect(sanitized).not.toContain('onfocus=')
    })

    it('should handle null bytes', () => {
      const input = 'hello\x00<script>alert(1)</script>world'
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toContain('\x00')
      expect(sanitized).not.toContain('<script')
    })

    it('should handle unicode obfuscation attempts', () => {
      const input = '<\u0073\u0063\u0072\u0069\u0070\u0074>alert(1)</script>'
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toContain('alert(1)')
    })
  })

  describe('SQL Injection Prevention via ILIKE Escape', () => {
    const sqlPayloads = [
      "'; DROP TABLE users; --",
      "1' OR '1'='1",
      "admin'--",
      "1; DELETE FROM users",
      "1' UNION SELECT * FROM passwords--",
      "' OR 1=1--",
      "'; EXEC xp_cmdshell('dir'); --",
      "%",
      "_",
      "\\",
      "%_%",
      "\\%",
      "\\_",
    ]

    it.each(sqlPayloads)('should escape ILIKE special chars: %s', (payload) => {
      const escaped = escapeILikePattern(payload)
      
      if (payload.includes('%')) {
        expect(escaped).toContain('\\%')
      }
      if (payload.includes('_')) {
        expect(escaped).toContain('\\_')
      }
      if (payload.includes('\\') && !payload.includes('\\%') && !payload.includes('\\_')) {
        expect(escaped).toContain('\\\\')
      }
    })
  })

  describe('UUID Validation', () => {
    const invalidUUIDs = [
      'not-a-uuid',
      '12345678-1234-1234-1234',
      '12345678-1234-1234-1234-12345678901234567',
      '',
      'null',
      'undefined',
      '12345678123412341234123456789012',
      '12345678-1234-1234-1234-12345678901g',
      '../../../etc/passwd',
      "'; DROP TABLE users; --",
      '<script>alert(1)</script>',
    ]

    it.each(invalidUUIDs)('should reject invalid UUID: %s', (uuid) => {
      expect(() => validateUUID(uuid)).toThrow(ApiError)
    })

    const validUUIDs = [
      '550e8400-e29b-41d4-a716-446655440000',
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    ]

    it.each(validUUIDs)('should accept valid UUID: %s', (uuid) => {
      expect(() => validateUUID(uuid)).not.toThrow()
    })
  })

  describe('Open Redirect Prevention', () => {
    const maliciousRedirects = [
      'https://evil.com',
      'http://attacker.org/phishing',
      '//evil.com',
      '//evil.com/path',
    ]

    it.each(maliciousRedirects)('should block malicious redirect: %s', (url) => {
      const result = getSafeRedirect(url)
      expect(result).toBe('/library')
    })

    const safeRedirects = [
      '/dashboard',
      '/user/profile',
      '/settings/account',
      '/library/manga/123',
    ]

    it.each(safeRedirects)('should allow safe internal redirect: %s', (url) => {
      const result = getSafeRedirect(url)
      expect(result).toBe(url)
    })
  })

  describe('Email Validation', () => {
    const invalidEmails = [
      'invalid',
      '@example.com',
      'test@',
      'test @example.com',
      'test@ example.com',
      '',
    ]

    it.each(invalidEmails)('should reject invalid email: %s', (email) => {
      expect(validateEmail(email)).toBe(false)
    })

    const validEmails = [
      'test@example.com',
      'user.name@domain.org',
      'user+tag@example.co.uk',
      'test123@test.io',
    ]

    it.each(validEmails)('should accept valid email: %s', (email) => {
      expect(validateEmail(email)).toBe(true)
    })
  })

  describe('Username Validation', () => {
    const invalidUsernames = [
      'ab',
      'a'.repeat(31),
      'user name',
      'user@name',
      'user#name',
      'user<script>',
      '',
      'user\nname',
      'user\tname',
    ]

    it.each(invalidUsernames)('should reject invalid username: "%s"', (username) => {
      expect(validateUsername(username)).toBe(false)
    })

    const validUsernames = [
      'user123',
      'user_name',
      'user-name',
      'abc',
      'a'.repeat(30),
      'User123',
      'USER_NAME',
    ]

    it.each(validUsernames)('should accept valid username: %s', (username) => {
      expect(validateUsername(username)).toBe(true)
    })
  })

  describe('Input Length Limits', () => {
    it('should truncate extremely long inputs', () => {
      const longInput = 'a'.repeat(100000)
      const sanitized = sanitizeInput(longInput, 1000)
      expect(sanitized.length).toBeLessThanOrEqual(1000)
    })

    it('should handle ReDoS-resistant truncation', () => {
      const start = Date.now()
      const maliciousInput = 'a'.repeat(1000000) + '<script>' + 'b'.repeat(1000000)
      sanitizeInput(maliciousInput, 100)
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(1000)
    })
  })

  describe('Protocol Injection Prevention', () => {
    const dangerousProtocols = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'about:blank',
      'blob:http://evil.com/uuid',
    ]

    it.each(dangerousProtocols)('should neutralize dangerous protocol: %s', (input) => {
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toMatch(/^(javascript|data|vbscript|file|about|blob):/i)
    })
  })

  describe('HTML Entity Encoding Edge Cases', () => {
    it('should handle nested encoding attempts', () => {
      const input = '&lt;script&gt;alert(1)&lt;/script&gt;'
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toContain('<script')
    })

    it('should handle hex encoding', () => {
      const input = '&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;'
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toContain('<script')
    })

    it('should handle decimal encoding', () => {
      const input = '&#60;script&#62;alert(1)&#60;/script&#62;'
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toContain('<script')
    })
  })
})
