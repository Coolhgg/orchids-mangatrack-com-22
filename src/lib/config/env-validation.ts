import { z } from 'zod';
import { randomBytes } from 'crypto';

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  
  DATABASE_URL: z.string().optional(),
  DATABASE_READ_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  
  REDIS_URL: z.string().optional(),
  
  INTERNAL_API_SECRET: z.string().optional(),
  INTERNAL_API_ALLOWED_CIDRS: z.string().optional(),
  
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  ALLOWED_REDIRECT_HOSTS: z.string().optional(),
  ALLOWED_CSRF_ORIGINS: z.string().optional(),
  
  FEATURE_FLAGS: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: Partial<EnvConfig>;
}

let validationResult: ValidationResult | null = null;

let generatedInternalSecret: string | null = null;

export function getInternalApiSecret(): string {
  if (process.env.INTERNAL_API_SECRET) {
    return process.env.INTERNAL_API_SECRET;
  }
  
  if (process.env.NODE_ENV === 'production') {
    throw new Error('INTERNAL_API_SECRET is required in production');
  }
  
  if (!generatedInternalSecret) {
    generatedInternalSecret = `dev-secret-${randomBytes(16).toString('hex')}`;
    console.warn(`[Security] INTERNAL_API_SECRET not set. Using generated dev secret: ${generatedInternalSecret.slice(0, 20)}...`);
  }
  
  return generatedInternalSecret;
}

export function validateEnv(): ValidationResult {
  if (validationResult) return validationResult;

  const errors: string[] = [];
  const warnings: string[] = [];

  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      errors.push(`${path}: ${issue.message}`);
    }
  }

  if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
    errors.push('DATABASE_URL is required in production');
  }

  if (!process.env.REDIS_URL) {
    warnings.push('REDIS_URL not set - falling back to in-memory rate limiting');
  }

  if (!process.env.INTERNAL_API_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      errors.push('INTERNAL_API_SECRET is required in production - internal APIs would be vulnerable');
    } else {
      warnings.push('INTERNAL_API_SECRET not set - using auto-generated dev secret');
    }
  }

  if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_SITE_URL) {
    warnings.push('NEXT_PUBLIC_SITE_URL not set - some features may not work correctly');
  }

  validationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
    config: result.success ? result.data : {},
  };

  return validationResult;
}

export function assertEnvValid(): void {
  const result = validateEnv();

  if (!result.valid) {
    const errorMessage = [
      'Environment validation failed:',
      ...result.errors.map(e => `  - ${e}`),
    ].join('\n');

    throw new Error(errorMessage);
  }

  if (result.warnings.length > 0 && process.env.NODE_ENV !== 'test') {
    console.warn('Environment warnings:', result.warnings);
  }
}

export function getEnvConfig(): EnvConfig {
  const result = validateEnv();
  return result.config as EnvConfig;
}

export function resetEnvValidation(): void {
  validationResult = null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}
