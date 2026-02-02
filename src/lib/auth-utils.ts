import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'

const SALT_ROUNDS = 12

// P0-1 FIX: Prevent hardcoded dev secret from leaking to production
// Generate ephemeral secret for dev only - never reuse a static fallback
let ephemeralDevSecret: string | null = null

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL: JWT_SECRET environment variable is required in production')
    }
    
    // Generate ephemeral secret for dev only - log warning
    if (!ephemeralDevSecret) {
      ephemeralDevSecret = crypto.randomBytes(32).toString('hex')
      console.warn('[Auth] WARNING: Using ephemeral JWT secret - DO NOT USE IN PRODUCTION')
      console.warn('[Auth] Set JWT_SECRET environment variable for persistent sessions')
    }
    return ephemeralDevSecret
  }
  
  return secret
}

// Lazy initialization to allow environment variables to be loaded
let JWT_SECRET: string | null = null

function getSecret(): string {
  if (!JWT_SECRET) {
    JWT_SECRET = getJwtSecret()
  }
  return JWT_SECRET
}

/**
 * Hashes a plain text password using bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

/**
 * Compares a plain text password with a hashed password.
 */
export async function comparePasswords(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Generates a JWT token for a user.
 */
export function generateToken(payload: any): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' })
}

/**
 * Verifies a JWT token.
 */
export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, getSecret())
  } catch (error) {
    return null
  }
}
