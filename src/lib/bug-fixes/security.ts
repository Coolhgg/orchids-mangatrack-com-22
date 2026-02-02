/**
 * E. SECURITY (Bugs 76-85)
 * 
 * Comprehensive security fixes for API and infrastructure.
 */

import { createHash, timingSafeEqual } from 'crypto';

// Bug 76: Internal APIs lack strong auth boundary
export interface InternalApiConfig {
  requiredHeader: string;
  tokenEnvVar: string;
  allowedIps?: string[];
}

export const INTERNAL_API_CONFIG: InternalApiConfig = {
  requiredHeader: 'X-Internal-Token',
  tokenEnvVar: 'INTERNAL_API_TOKEN',
  allowedIps: ['127.0.0.1', '::1']
};

export function validateInternalToken(providedToken: string | null): boolean {
  const expectedToken = process.env[INTERNAL_API_CONFIG.tokenEnvVar];
  
  if (!expectedToken || !providedToken) {
    return false;
  }

  try {
    const providedBuffer = Buffer.from(providedToken);
    const expectedBuffer = Buffer.from(expectedToken);
    
    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(providedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function isInternalIp(ip: string): boolean {
  const internalPatterns = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/
  ];
  
  return internalPatterns.some(pattern => pattern.test(ip));
}

// Bug 77: Worker endpoints callable without strict verification
export interface WorkerAuthConfig {
  secretHeader: string;
  secretEnvVar: string;
  requiredRole: string;
}

export const WORKER_AUTH_CONFIG: WorkerAuthConfig = {
  secretHeader: 'X-Worker-Secret',
  secretEnvVar: 'WORKER_SECRET',
  requiredRole: 'worker'
};

export function validateWorkerRequest(
  headers: Record<string, string | undefined>,
  config: WorkerAuthConfig = WORKER_AUTH_CONFIG
): { valid: boolean; reason: string } {
  const secret = headers[config.secretHeader.toLowerCase()];
  const expectedSecret = process.env[config.secretEnvVar];

  if (!expectedSecret) {
    return { valid: false, reason: 'Worker secret not configured' };
  }

  if (!secret) {
    return { valid: false, reason: 'Missing worker authentication header' };
  }

  try {
    const secretBuffer = Buffer.from(secret);
    const expectedBuffer = Buffer.from(expectedSecret);
    
    if (secretBuffer.length !== expectedBuffer.length) {
      return { valid: false, reason: 'Invalid worker secret' };
    }
    
    if (!timingSafeEqual(secretBuffer, expectedBuffer)) {
      return { valid: false, reason: 'Invalid worker secret' };
    }
  } catch {
    return { valid: false, reason: 'Invalid worker secret format' };
  }

  return { valid: true, reason: 'Worker authenticated' };
}

// Bug 78: Rate limiting missing on retry endpoints
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  skipSuccessfulRequests: boolean;
}

export const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  'retry-metadata': {
    windowMs: 60000,
    maxRequests: 10,
    keyPrefix: 'rl:retry-metadata',
    skipSuccessfulRequests: false
  },
  'retry-all-metadata': {
    windowMs: 3600000,
    maxRequests: 3,
    keyPrefix: 'rl:retry-all',
    skipSuccessfulRequests: false
  },
  'import': {
    windowMs: 3600000,
    maxRequests: 5,
    keyPrefix: 'rl:import',
    skipSuccessfulRequests: false
  },
  'api-general': {
    windowMs: 60000,
    maxRequests: 100,
    keyPrefix: 'rl:api',
    skipSuccessfulRequests: true
  }
};

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimitInMemory(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: Date } {
  const fullKey = `${config.keyPrefix}:${key}`;
  const now = Date.now();
  const existing = rateLimitStore.get(fullKey);

  if (!existing || existing.resetAt < now) {
    rateLimitStore.set(fullKey, { count: 1, resetAt: now + config.windowMs });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: new Date(now + config.windowMs)
    };
  }

  if (existing.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(existing.resetAt)
    };
  }

  existing.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - existing.count,
    resetAt: new Date(existing.resetAt)
  };
}

// Bug 79: Error messages may leak infrastructure details
const SENSITIVE_PATTERNS = [
  /database|postgresql|mysql|mongodb|redis/gi,
  /prisma|supabase|firebase/gi,
  /api[_-]?key|secret|token|password/gi,
  /https?:\/\/[^:]+:[^@]+@/gi,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  /at\s+\S+\s+\(\S+:\d+:\d+\)/g,
  /\/home\/\w+|\/var\/|\/usr\//g,
  /node_modules/g,
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/g
];

export function sanitizeErrorForClient(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  
  for (const pattern of SENSITIVE_PATTERNS) {
    message = message.replace(pattern, '[REDACTED]');
  }
  
  if (message.length > 200) {
    message = message.substring(0, 200) + '...';
  }

  if (message.includes('[REDACTED]') || message.length < 10) {
    return 'An error occurred. Please try again later.';
  }

  return message;
}

export function createSafeErrorResponse(
  error: unknown,
  requestId: string
): { error: string; code: string; requestId: string } {
  const sanitized = sanitizeErrorForClient(error);
  const code = error instanceof Error ? error.name : 'UnknownError';
  
  return {
    error: sanitized,
    code,
    requestId
  };
}

// Bug 80: No replay protection on internal requests
export interface ReplayProtection {
  nonceHeader: string;
  timestampHeader: string;
  maxAgeMs: number;
}

export const REPLAY_PROTECTION_CONFIG: ReplayProtection = {
  nonceHeader: 'X-Request-Nonce',
  timestampHeader: 'X-Request-Timestamp',
  maxAgeMs: 300000
};

const usedNonces = new Map<string, number>();

export function validateReplayProtection(
  nonce: string | null,
  timestamp: string | null,
  config: ReplayProtection = REPLAY_PROTECTION_CONFIG
): { valid: boolean; reason: string } {
  if (!nonce || !timestamp) {
    return { valid: false, reason: 'Missing replay protection headers' };
  }

  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return { valid: false, reason: 'Invalid timestamp format' };
  }

  const now = Date.now();
  const age = now - requestTime;

  if (age < 0) {
    return { valid: false, reason: 'Request timestamp is in the future' };
  }

  if (age > config.maxAgeMs) {
    return { valid: false, reason: 'Request timestamp is too old' };
  }

  if (usedNonces.has(nonce)) {
    return { valid: false, reason: 'Nonce has already been used' };
  }

  usedNonces.set(nonce, now);
  
  for (const [storedNonce, storedTime] of usedNonces) {
    if (now - storedTime > config.maxAgeMs * 2) {
      usedNonces.delete(storedNonce);
    }
  }

  return { valid: true, reason: 'Request validated' };
}

// Bug 81: Over-privileged DB role for workers
export interface DbRoleConfig {
  roleName: string;
  allowedOperations: string[];
  allowedTables: string[];
}

export const DB_ROLE_CONFIGS: Record<string, DbRoleConfig> = {
  worker_sync: {
    roleName: 'worker_sync',
    allowedOperations: ['SELECT', 'INSERT', 'UPDATE'],
    allowedTables: ['series_sources', 'chapters', 'chapter_sources', 'feed_entries']
  },
  worker_resolution: {
    roleName: 'worker_resolution',
    allowedOperations: ['SELECT', 'INSERT', 'UPDATE'],
    allowedTables: ['library_entries', 'series', 'series_sources']
  },
  worker_notification: {
    roleName: 'worker_notification',
    allowedOperations: ['SELECT', 'INSERT'],
    allowedTables: ['notifications', 'notification_queue', 'users']
  },
  api_read: {
    roleName: 'api_read',
    allowedOperations: ['SELECT'],
    allowedTables: ['*']
  }
};

// Bug 82: No separation of read/write DB roles
export interface ConnectionPoolConfig {
  poolName: string;
  connectionString: string;
  maxConnections: number;
  role: 'read' | 'write' | 'admin';
}

export function selectConnectionPool(
  operation: 'read' | 'write',
  pools: ConnectionPoolConfig[]
): ConnectionPoolConfig | null {
  const pool = pools.find(p => {
    if (operation === 'read') {
      return p.role === 'read' || p.role === 'write';
    }
    return p.role === 'write' || p.role === 'admin';
  });
  return pool || null;
}

// Bug 83: No tamper detection on job payloads
export function signJobPayload(payload: unknown, secret: string): string {
  const payloadStr = JSON.stringify(payload);
  return createHash('sha256')
    .update(payloadStr + secret)
    .digest('hex');
}

export function verifyJobPayload(
  payload: unknown,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = signJobPayload(payload, secret);
  
  try {
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

// Bug 84: Metadata ingestion trusts external payload shape
import { z } from 'zod';

export const ExternalMetadataSchema = z.object({
  id: z.string().max(255),
  title: z.string().max(500),
  description: z.string().max(10000).optional(),
  cover_url: z.string().url().max(2000).optional(),
  status: z.enum(['ongoing', 'completed', 'hiatus', 'cancelled']).optional(),
  type: z.enum(['manga', 'manhwa', 'manhua', 'comic', 'novel']).optional(),
  genres: z.array(z.string().max(50)).max(50).optional(),
  alternative_titles: z.array(z.string().max(500)).max(100).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  content_rating: z.enum(['safe', 'suggestive', 'erotica', 'pornographic']).optional()
});

export type ExternalMetadata = z.infer<typeof ExternalMetadataSchema>;

export function validateExternalMetadata(data: unknown): {
  valid: boolean;
  data?: ExternalMetadata;
  errors: string[];
} {
  const result = ExternalMetadataSchema.safeParse(data);
  
  if (result.success) {
    return { valid: true, data: result.data, errors: [] };
  }
  
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

// Bug 85: No integrity verification of external IDs
export interface ExternalIdValidation {
  platform: string;
  pattern: RegExp;
  maxLength: number;
}

export const EXTERNAL_ID_PATTERNS: ExternalIdValidation[] = [
  {
    platform: 'mangadex',
    pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
    maxLength: 36
  },
  {
    platform: 'mangasee',
    pattern: /^[a-zA-Z0-9_-]+$/,
    maxLength: 200
  },
  {
    platform: 'asura',
    pattern: /^[a-zA-Z0-9_-]+$/,
    maxLength: 200
  },
  {
    platform: 'generic',
    pattern: /^[a-zA-Z0-9_\-:.]+$/,
    maxLength: 500
  }
];

export function validateExternalId(
  platform: string,
  id: string
): { valid: boolean; reason: string } {
  if (!id || typeof id !== 'string') {
    return { valid: false, reason: 'ID must be a non-empty string' };
  }

  const config = EXTERNAL_ID_PATTERNS.find(p => p.platform === platform) ||
    EXTERNAL_ID_PATTERNS.find(p => p.platform === 'generic')!;

  if (id.length > config.maxLength) {
    return { valid: false, reason: `ID exceeds maximum length of ${config.maxLength}` };
  }

  if (!config.pattern.test(id)) {
    return { valid: false, reason: `ID does not match expected format for ${platform}` };
  }

  return { valid: true, reason: 'ID is valid' };
}

// CSRF Protection utilities
export function generateCsrfToken(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, b => b.toString(16).padStart(2, '0')).join('');
}

export function validateCsrfToken(
  providedToken: string | null,
  storedToken: string | null
): boolean {
  if (!providedToken || !storedToken) {
    return false;
  }

  try {
    const providedBuffer = Buffer.from(providedToken);
    const storedBuffer = Buffer.from(storedToken);
    
    if (providedBuffer.length !== storedBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(providedBuffer, storedBuffer);
  } catch {
    return false;
  }
}

// Request correlation for security auditing
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

export interface SecurityAuditLog {
  requestId: string;
  timestamp: Date;
  action: string;
  userId: string | null;
  ip: string;
  userAgent: string | null;
  success: boolean;
  details: Record<string, unknown>;
}

export function createSecurityAuditLog(
  action: string,
  userId: string | null,
  ip: string,
  userAgent: string | null,
  success: boolean,
  details: Record<string, unknown> = {}
): SecurityAuditLog {
  return {
    requestId: generateRequestId(),
    timestamp: new Date(),
    action,
    userId,
    ip,
    userAgent,
    success,
    details
  };
}
