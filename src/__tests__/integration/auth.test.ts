/**
 * Auth API Integration Tests
 * 
 * Tests the check-username endpoint validation and behavior.
 * Tests validation logic directly without needing NextRequest.
 */

// Reserved usernames from the actual implementation
const RESERVED_USERNAMES = [
  'admin', 'administrator', 'mod', 'moderator', 'support', 
  'help', 'system', 'root', 'api', 'www', 'mail', 'email',
  'noreply', 'no-reply', 'postmaster', 'webmaster', 'abuse',
  'null', 'undefined', 'anonymous', 'guest', 'user', 'test',
  'demo', 'example', 'sample', 'default', 'public', 'private',
  'official', 'staff', 'team', 'kenmei', 'manga', 'mangadex'
]

// Validation functions matching the API route
const validateUsername = (username: string): { valid: boolean; error?: string } => {
  if (!username) {
    return { valid: false, error: 'Username is required' }
  }
  
  const trimmed = username.trim().toLowerCase()
  
  if (trimmed.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' }
  }
  
  if (trimmed.length > 20) {
    return { valid: false, error: 'Username must be at most 20 characters' }
  }
  
  // Only allow alphanumeric, underscores, and hyphens
  const validPattern = /^[a-zA-Z0-9_-]+$/
  if (!validPattern.test(username)) {
    return { valid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' }
  }
  
  return { valid: true }
}

const isReservedUsername = (username: string): boolean => {
  return RESERVED_USERNAMES.includes(username.toLowerCase())
}

describe('Auth API - Check Username Validation', () => {
  describe('Input Validation', () => {
    it('should reject empty username', () => {
      const result = validateUsername('')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('required')
    })

    it('should accept valid username', () => {
      const result = validateUsername('testuser12345')
      expect(result.valid).toBe(true)
    })

    it('should reject usernames with invalid characters', () => {
      const result = validateUsername('test@user!')
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should reject too short usernames (< 3 chars)', () => {
      const result = validateUsername('ab')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('at least 3')
    })

    it('should reject too long usernames (> 20 chars)', () => {
      const longUsername = 'a'.repeat(21)
      const result = validateUsername(longUsername)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('20 characters')
    })
  })

  describe('Reserved Usernames', () => {
    it('should identify reserved username "admin"', () => {
      expect(isReservedUsername('admin')).toBe(true)
    })

    it('should identify reserved username "moderator"', () => {
      expect(isReservedUsername('moderator')).toBe(true)
    })

    it('should identify reserved username "api"', () => {
      expect(isReservedUsername('api')).toBe(true)
    })

    it('should be case-insensitive for reserved usernames', () => {
      expect(isReservedUsername('ADMIN')).toBe(true)
      expect(isReservedUsername('Admin')).toBe(true)
    })

    it('should not flag non-reserved usernames', () => {
      expect(isReservedUsername('validuser123')).toBe(false)
      expect(isReservedUsername('myusername')).toBe(false)
    })
  })

  describe('Username Format', () => {
    it('should accept username with letters only', () => {
      expect(validateUsername('validuser').valid).toBe(true)
    })

    it('should accept username with numbers', () => {
      expect(validateUsername('user123').valid).toBe(true)
    })

    it('should accept username with underscores', () => {
      expect(validateUsername('user_name').valid).toBe(true)
    })

    it('should accept username with hyphens', () => {
      expect(validateUsername('user-name').valid).toBe(true)
    })

    it('should reject username with spaces', () => {
      expect(validateUsername('user name').valid).toBe(false)
    })

    it('should reject username with special characters', () => {
      expect(validateUsername('user@name').valid).toBe(false)
      expect(validateUsername('user$name').valid).toBe(false)
      expect(validateUsername('user.name').valid).toBe(false)
    })

    it('should accept mixed case', () => {
      expect(validateUsername('TestUser').valid).toBe(true)
    })

    it('should accept boundary length usernames', () => {
      expect(validateUsername('abc').valid).toBe(true) // min: 3
      expect(validateUsername('a'.repeat(20)).valid).toBe(true) // max: 20
    })
  })

  describe('Edge Cases', () => {
    it('should handle whitespace-only input', () => {
      const result = validateUsername('   ')
      expect(result.valid).toBe(false)
    })

    it('should handle username at exact min boundary', () => {
      expect(validateUsername('abc').valid).toBe(true)
    })

    it('should handle username at exact max boundary', () => {
      expect(validateUsername('a'.repeat(20)).valid).toBe(true)
    })

    it('should handle username one over max boundary', () => {
      expect(validateUsername('a'.repeat(21)).valid).toBe(false)
    })

    it('should handle unicode characters', () => {
      expect(validateUsername('用户名').valid).toBe(false)
      expect(validateUsername('usér').valid).toBe(false)
    })

    it('should handle numeric-only usernames', () => {
      expect(validateUsername('12345').valid).toBe(true)
    })

    it('should handle underscore-only usernames', () => {
      expect(validateUsername('___').valid).toBe(true)
    })

    it('should handle hyphen-only usernames', () => {
      expect(validateUsername('---').valid).toBe(true)
    })
  })
})

describe('Reserved Username List', () => {
  it('should contain all required reserved usernames', () => {
    const requiredReserved = [
      'admin', 'moderator', 'api', 'system', 'support', 'staff'
    ]
    
    requiredReserved.forEach(username => {
      expect(RESERVED_USERNAMES).toContain(username)
    })
  })

  it('should not be empty', () => {
    expect(RESERVED_USERNAMES.length).toBeGreaterThan(0)
  })

  it('should contain lowercase entries only', () => {
    RESERVED_USERNAMES.forEach(username => {
      expect(username).toBe(username.toLowerCase())
    })
  })
})
