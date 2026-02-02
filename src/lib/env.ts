const requiredEnvVars = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
} as const

const optionalEnvVars = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_READ_URL: process.env.DATABASE_READ_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  REDIS_URL: process.env.REDIS_URL,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
} as const

type RequiredEnvVars = typeof requiredEnvVars
type OptionalEnvVars = typeof optionalEnvVars

function validateEnvVar(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Please check your .env file and ensure ${name} is set.`
    )
  }
  return value
}

function getValidatedEnv(): { 
  required: { [K in keyof RequiredEnvVars]: string }
  optional: OptionalEnvVars 
} {
  const validated: Record<string, string> = {}
  
  for (const [key, value] of Object.entries(requiredEnvVars)) {
    validated[key] = validateEnvVar(key, value)
  }
  
  return {
    required: validated as { [K in keyof RequiredEnvVars]: string },
    optional: optionalEnvVars,
  }
}

let cachedEnv: ReturnType<typeof getValidatedEnv> | null = null

export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = getValidatedEnv()
  }
  return cachedEnv
}

export function getSupabaseUrl(): string {
  return getEnv().required.NEXT_PUBLIC_SUPABASE_URL
}

export function getSupabaseAnonKey(): string {
  return getEnv().required.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

export function getDatabaseUrl(): string | undefined {
  return getEnv().optional.DATABASE_URL
}

export function getRedisUrl(): string | undefined {
  return getEnv().optional.REDIS_URL
}

export function isProduction(): boolean {
  return getEnv().optional.NODE_ENV === 'production'
}

export function isDevelopment(): boolean {
  return getEnv().optional.NODE_ENV === 'development'
}
