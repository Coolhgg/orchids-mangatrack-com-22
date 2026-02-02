import {
  sanitizeInput,
  htmlEncode,
  validateUUID,
  validateEmail,
  validateUsername,
  escapeILikePattern,
  getSafeRedirect,
  parsePaginationParams,
  toTitleCase,
  normalizeToTitleCase,
  sanitizeFilterArray,
  isIpInRange,
  ApiError,
  ErrorCodes,
} from '@/lib/api-utils'

describe('api-utils', () => {
  describe('sanitizeInput', () => {
    it('should remove script tags', () => {
      const input = '<script>alert("xss")</script>Hello'
      expect(sanitizeInput(input)).toBe('Hello')
    })

    it('should remove iframe tags', () => {
      const input = '<iframe src="evil.com"></iframe>Content'
      expect(sanitizeInput(input)).toBe('Content')
    })

    it('should remove javascript: protocols', () => {
      const input = 'javascript:alert(1)'
      expect(sanitizeInput(input)).toBe('alert(1)')
    })

    it('should remove event handlers', () => {
      const input = 'onclick=alert(1) test'
      expect(sanitizeInput(input)).toBe('data-sanitized-attr=alert(1) test')
    })

    it('should truncate to maxLength', () => {
      const input = 'a'.repeat(200)
      expect(sanitizeInput(input, 100)).toHaveLength(100)
    })

    it('should handle empty input', () => {
      expect(sanitizeInput('')).toBe('')
    })

    it('should remove null bytes', () => {
      const input = 'hello\x00world'
      expect(sanitizeInput(input)).toBe('helloworld')
    })

    it('should remove data: protocols', () => {
      const input = 'data:text/html,<script>alert(1)</script>'
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toMatch(/^data:/i)
    })
  })

  describe('htmlEncode', () => {
    it('should encode HTML special characters', () => {
      expect(htmlEncode('<script>')).toBe('&lt;script&gt;')
      expect(htmlEncode('"quotes"')).toBe('&quot;quotes&quot;')
      expect(htmlEncode("'single'")).toBe('&#x27;single&#x27;')
      expect(htmlEncode('a & b')).toBe('a &amp; b')
    })

    it('should encode forward slashes', () => {
      expect(htmlEncode('path/to/file')).toBe('path&#x2F;to&#x2F;file')
    })
  })

  describe('validateUUID', () => {
    it('should accept valid UUIDs', () => {
      expect(() => validateUUID('550e8400-e29b-41d4-a716-446655440000')).not.toThrow()
      expect(() => validateUUID('550E8400-E29B-41D4-A716-446655440000')).not.toThrow()
    })

    it('should reject invalid UUIDs', () => {
      expect(() => validateUUID('not-a-uuid')).toThrow(ApiError)
      expect(() => validateUUID('550e8400-e29b-41d4-a716')).toThrow(ApiError)
      expect(() => validateUUID('')).toThrow(ApiError)
      expect(() => validateUUID('550e8400e29b41d4a716446655440000')).toThrow(ApiError)
    })

    it('should use custom field name in error message', () => {
      try {
        validateUUID('invalid', 'user ID')
      } catch (e) {
        expect((e as ApiError).message).toContain('user ID')
      }
    })
  })

  describe('validateEmail', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('test@example.com')).toBe(true)
      expect(validateEmail('user.name@domain.org')).toBe(true)
      expect(validateEmail('user+tag@example.co.uk')).toBe(true)
    })

    it('should reject invalid emails', () => {
      expect(validateEmail('invalid')).toBe(false)
      expect(validateEmail('test@')).toBe(false)
      expect(validateEmail('@example.com')).toBe(false)
      expect(validateEmail('test @example.com')).toBe(false)
    })
  })

  describe('validateUsername', () => {
    it('should accept valid usernames', () => {
      expect(validateUsername('user123')).toBe(true)
      expect(validateUsername('user_name')).toBe(true)
      expect(validateUsername('user-name')).toBe(true)
      expect(validateUsername('abc')).toBe(true)
    })

    it('should reject invalid usernames', () => {
      expect(validateUsername('ab')).toBe(false) // too short
      expect(validateUsername('a'.repeat(31))).toBe(false) // too long
      expect(validateUsername('user name')).toBe(false) // spaces
      expect(validateUsername('user@name')).toBe(false) // special chars
      expect(validateUsername('')).toBe(false)
    })
  })

  describe('escapeILikePattern', () => {
    it('should escape percent signs', () => {
      expect(escapeILikePattern('100%')).toBe('100\\%')
    })

    it('should escape underscores', () => {
      expect(escapeILikePattern('file_name')).toBe('file\\_name')
    })

    it('should escape backslashes first', () => {
      expect(escapeILikePattern('path\\to')).toBe('path\\\\to')
    })

    it('should handle combined special characters', () => {
      expect(escapeILikePattern('100%_test\\path')).toBe('100\\%\\_test\\\\path')
    })
  })

  describe('getSafeRedirect', () => {
    it('should return default for null/undefined', () => {
      expect(getSafeRedirect(null)).toBe('/library')
      expect(getSafeRedirect(undefined)).toBe('/library')
    })

    it('should allow internal paths', () => {
      expect(getSafeRedirect('/dashboard')).toBe('/dashboard')
      expect(getSafeRedirect('/user/profile')).toBe('/user/profile')
    })

    it('should block protocol-relative URLs', () => {
      expect(getSafeRedirect('//evil.com')).toBe('/library')
      expect(getSafeRedirect('//evil.com/path')).toBe('/library')
    })

    it('should block external domains by default', () => {
      expect(getSafeRedirect('https://evil.com')).toBe('/library')
      expect(getSafeRedirect('http://attacker.org/path')).toBe('/library')
    })

    it('should accept custom default URL', () => {
      expect(getSafeRedirect(null, '/home')).toBe('/home')
    })
  })

  describe('parsePaginationParams', () => {
    it('should parse default values', () => {
      const params = new URLSearchParams()
      const result = parsePaginationParams(params)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
      expect(result.offset).toBe(0)
    })

    it('should parse limit correctly', () => {
      const params = new URLSearchParams('limit=50')
      const result = parsePaginationParams(params)
      expect(result.limit).toBe(50)
    })

    it('should cap limit at 100', () => {
      const params = new URLSearchParams('limit=500')
      const result = parsePaginationParams(params)
      expect(result.limit).toBe(100)
    })

    it('should parse page correctly', () => {
      const params = new URLSearchParams('page=3')
      const result = parsePaginationParams(params)
      expect(result.page).toBe(3)
      expect(result.offset).toBe(40) // (3-1) * 20
    })

    it('should handle invalid values gracefully', () => {
      const params = new URLSearchParams('limit=invalid&page=abc')
      const result = parsePaginationParams(params)
      expect(result.limit).toBe(20)
      expect(result.page).toBe(1)
    })

    it('should handle negative values', () => {
      const params = new URLSearchParams('limit=-10&page=-5')
      const result = parsePaginationParams(params)
      expect(result.limit).toBe(1)
      expect(result.page).toBe(1)
    })
  })

  describe('toTitleCase', () => {
    it('should convert to title case', () => {
      expect(toTitleCase('hello world')).toBe('Hello World')
      expect(toTitleCase('UPPER CASE')).toBe('Upper Case')
    })

    it('should handle kebab-case', () => {
      expect(toTitleCase('sci-fi')).toBe('Sci-Fi')
      expect(toTitleCase('post-apocalyptic')).toBe('Post-Apocalyptic')
    })

    it('should handle special cases', () => {
      expect(toTitleCase('boys love')).toBe("Boys' Love")
      expect(toTitleCase('girls love')).toBe("Girls' Love")
    })

    it('should lowercase minor words except first/last', () => {
      expect(toTitleCase('lord of the rings')).toBe('Lord of the Rings')
    })
  })

  describe('normalizeToTitleCase', () => {
    it('should convert array to title case', () => {
      const result = normalizeToTitleCase(['action', 'sci-fi', 'DRAMA'])
      expect(result).toEqual(['Action', 'Sci-Fi', 'Drama'])
    })

    it('should handle non-array input', () => {
      expect(normalizeToTitleCase(null as any)).toEqual([])
      expect(normalizeToTitleCase(undefined as any)).toEqual([])
    })
  })

  describe('sanitizeFilterArray', () => {
    it('should filter and sanitize array values', () => {
      const input = ['valid', '<script>xss</script>', '', 'also-valid']
      const result = sanitizeFilterArray(input)
      expect(result).toContain('valid')
      expect(result).toContain('also-valid')
      expect(result.some(r => r.includes('<script'))).toBe(false)
    })

    it('should limit array length', () => {
      const input = Array(100).fill('item')
      const result = sanitizeFilterArray(input, 10)
      expect(result).toHaveLength(10)
    })

    it('should handle non-array input', () => {
      expect(sanitizeFilterArray(null as any)).toEqual([])
      expect(sanitizeFilterArray(undefined as any)).toEqual([])
    })
  })

  describe('isIpInRange', () => {
    it('should match exact IP without CIDR', () => {
      expect(isIpInRange('192.168.1.1', '192.168.1.1')).toBe(true)
      expect(isIpInRange('192.168.1.2', '192.168.1.1')).toBe(false)
    })

    it('should match IP in CIDR range', () => {
      expect(isIpInRange('192.168.1.50', '192.168.1.0/24')).toBe(true)
      expect(isIpInRange('192.168.2.1', '192.168.1.0/24')).toBe(false)
    })

    it('should handle /32 CIDR (single IP)', () => {
      expect(isIpInRange('10.0.0.1', '10.0.0.1/32')).toBe(true)
      expect(isIpInRange('10.0.0.2', '10.0.0.1/32')).toBe(false)
    })

    it('should handle invalid input', () => {
      expect(isIpInRange('invalid', '192.168.1.0/24')).toBe(false)
      expect(isIpInRange('192.168.1.1', 'invalid')).toBe(false)
    })
  })

  describe('ApiError', () => {
    it('should create error with default values', () => {
      const error = new ApiError('Test error')
      expect(error.message).toBe('Test error')
      expect(error.statusCode).toBe(500)
      expect(error.code).toBeUndefined()
    })

    it('should create error with custom values', () => {
      const error = new ApiError('Not found', 404, ErrorCodes.NOT_FOUND)
      expect(error.message).toBe('Not found')
      expect(error.statusCode).toBe(404)
      expect(error.code).toBe(ErrorCodes.NOT_FOUND)
    })
  })
})
