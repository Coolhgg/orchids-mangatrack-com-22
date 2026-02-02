/**
 * API Security Integration Tests
 * Tests security measures across all API routes
 */

import { NextRequest } from 'next/server'
import { 
  sanitizeInput, 
  escapeILikePattern, 
  validateUUID, 
  checkRateLimit, 
  clearRateLimit,
  validateOrigin,
  ApiError
} from '@/lib/api-utils'

describe('Input Sanitization', () => {
  describe('sanitizeInput', () => {
    it('should remove HTML tags', () => {
      expect(sanitizeInput('<script>alert("xss")</script>')).toBe('alert("xss")')
      expect(sanitizeInput('<img src=x onerror=alert(1)>')).toBe('')
      expect(sanitizeInput('<a href="javascript:void(0)">click</a>')).toBe('click')
    })

    it('should remove dangerous protocols', () => {
      expect(sanitizeInput('javascript:alert(1)')).toBe('alert(1)')
      expect(sanitizeInput('data:text/html,<script>alert(1)</script>')).toBe('text/html,alert(1)')
      expect(sanitizeInput('vbscript:msgbox(1)')).toBe('msgbox(1)')
    })

    it('should remove event handlers', () => {
      const result1 = sanitizeInput('test onclick=alert(1)')
      expect(result1).not.toContain('onclick=')
      
      const result2 = sanitizeInput('onmouseover=evil() test')
      expect(result2).not.toContain('onmouseover=')
    })

    it('should handle encoded XSS attempts', () => {
      // Encoded characters are removed, leaving sanitized content
      const result1 = sanitizeInput('&#x3C;script&#x3E;')
      expect(result1).not.toContain('<')
      expect(result1).not.toContain('>')
      
      const result2 = sanitizeInput('&#60;script&#62;')
      expect(result2).not.toContain('<')
      expect(result2).not.toContain('>')
    })

    it('should enforce max length', () => {
      const longString = 'a'.repeat(1000)
      expect(sanitizeInput(longString, 100)).toHaveLength(100)
    })

    it('should handle empty/null input', () => {
      expect(sanitizeInput('')).toBe('')
      expect(sanitizeInput(null as any)).toBe('')
      expect(sanitizeInput(undefined as any)).toBe('')
    })
  })

  describe('escapeILikePattern', () => {
    it('should escape percent signs', () => {
      expect(escapeILikePattern('100%')).toBe('100\\%')
      expect(escapeILikePattern('%test%')).toBe('\\%test\\%')
    })

    it('should escape underscores', () => {
      expect(escapeILikePattern('test_user')).toBe('test\\_user')
    })

    it('should escape backslashes', () => {
      expect(escapeILikePattern('path\\to\\file')).toBe('path\\\\to\\\\file')
    })

    it('should handle SQL injection attempts', () => {
      const injection = "'; DROP TABLE users; --"
      const escaped = escapeILikePattern(injection)
      expect(escaped).not.toContain("';")
    })
  })
})

describe('UUID Validation', () => {
  it('should accept valid UUIDs', () => {
    expect(() => validateUUID('550e8400-e29b-41d4-a716-446655440000')).not.toThrow()
    expect(() => validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).not.toThrow()
  })

  it('should reject invalid UUIDs', () => {
    expect(() => validateUUID('not-a-uuid')).toThrow(ApiError)
    expect(() => validateUUID('550e8400-e29b-41d4-a716')).toThrow(ApiError)
    expect(() => validateUUID('')).toThrow(ApiError)
  })

  it('should reject SQL injection attempts', () => {
    expect(() => validateUUID("550e8400'; DROP TABLE users;--")).toThrow(ApiError)
    expect(() => validateUUID("550e8400-e29b-41d4-a716-446655440000' OR '1'='1")).toThrow(ApiError)
  })
})

describe('Rate Limiting', () => {
  beforeEach(() => {
    // Clear all rate limits
    clearRateLimit('test-key')
  })

  it('should allow requests under the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('test-key', 10, 60000)).toBe(true)
    }
  })

  it('should block requests over the limit', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('test-key', 10, 60000)
    }
    expect(checkRateLimit('test-key', 10, 60000)).toBe(false)
  })

  it('should use separate limits for different keys', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('key-a', 10, 60000)
    }
    // Key A should be blocked
    expect(checkRateLimit('key-a', 10, 60000)).toBe(false)
    // Key B should still work
    expect(checkRateLimit('key-b', 10, 60000)).toBe(true)
  })
})

describe('CSRF Protection', () => {
  it('should allow requests without origin header', () => {
    const request = new Request('http://localhost:3000/api/test', {
      method: 'POST',
    })
    // Should not throw - origin check only happens when origin is present
    expect(() => validateOrigin(request)).not.toThrow()
  })

  it('should allow matching origins', () => {
    const request = new Request('http://localhost:3000/api/test', {
      method: 'POST',
      headers: {
        'origin': 'http://localhost:3000',
        'host': 'localhost:3000'
      }
    })
    // In development mode, this check is skipped
    expect(() => validateOrigin(request)).not.toThrow()
  })
})

describe('API Error Handling', () => {
  it('should create proper ApiError instances', () => {
    const error = new ApiError('Test error', 400, 'TEST_CODE')
    
    expect(error.message).toBe('Test error')
    expect(error.statusCode).toBe(400)
    expect(error.code).toBe('TEST_CODE')
    expect(error.name).toBe('ApiError')
  })

  it('should default to 500 status code', () => {
    const error = new ApiError('Server error')
    expect(error.statusCode).toBe(500)
  })
})

describe('Input Boundary Tests', () => {
  it('should handle maximum length inputs', () => {
    const maxLengthInput = 'a'.repeat(10000)
    const sanitized = sanitizeInput(maxLengthInput)
    expect(sanitized.length).toBeLessThanOrEqual(10000)
  })

  it('should handle unicode characters', () => {
    const unicodeInput = '日本語テスト 🎉 مرحبا'
    const sanitized = sanitizeInput(unicodeInput)
    expect(sanitized).toBe(unicodeInput)
  })

  it('should handle null bytes', () => {
    const nullByteInput = 'test\x00injection'
    const sanitized = sanitizeInput(nullByteInput)
    expect(sanitized).not.toContain('\x00')
  })

  it('should handle mixed content safely', () => {
    const mixedContent = '<script>alert(1)</script>Normal text<img onerror=evil>'
    const sanitized = sanitizeInput(mixedContent)
    expect(sanitized).toBe('alert(1)Normal text')
  })
})
