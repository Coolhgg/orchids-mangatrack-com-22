import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Singleton pattern for Supabase admin clients (write + optional read replica)
const globalForSupabase = global as unknown as { 
  supabaseAdmin: SupabaseClient
  supabaseAdminRead: SupabaseClient | null
}

function createSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: {
      schema: 'public'
    }
  })
}

// Read replica client (optional - uses SUPABASE_READ_URL if configured)
function createSupabaseAdminRead(): SupabaseClient | null {
  const readUrl = process.env.SUPABASE_READ_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!readUrl || !key) return null
  
  return createClient(readUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: {
      schema: 'public'
    }
  })
}

// Primary write client (always uses NEXT_PUBLIC_SUPABASE_URL)
export const supabaseAdmin = globalForSupabase.supabaseAdmin ?? createSupabaseAdmin()

// Read replica client (falls back to primary if not configured)
export const supabaseAdminRead = globalForSupabase.supabaseAdminRead ?? createSupabaseAdminRead() ?? supabaseAdmin

// Convenience: check if read replica is active
export const hasSupabaseReadReplica = !!process.env.SUPABASE_READ_URL

if (process.env.NODE_ENV !== 'production') {
  globalForSupabase.supabaseAdmin = supabaseAdmin
  globalForSupabase.supabaseAdminRead = supabaseAdminRead === supabaseAdmin ? null : supabaseAdminRead
}

/**
 * Database query helper with error handling
 */
export async function dbQuery<T>(
  queryFn: (client: SupabaseClient) => Promise<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data, error } = await queryFn(supabaseAdmin)
    
    if (error) {
      console.error('[DB Error]', error.message || error)
      return { data: null, error: error.message || 'Database query failed' }
    }
    
    return { data, error: null }
  } catch (err: any) {
    console.error('[DB Exception]', err.message || err)
    return { data: null, error: err.message || 'Database query failed' }
  }
}

/**
 * Execute a query and return data or throw
 */
export async function dbQueryOrThrow<T>(
  queryFn: (client: SupabaseClient) => Promise<{ data: T | null; error: any }>
): Promise<T> {
  const { data, error } = await dbQuery(queryFn)
  
  if (error || data === null) {
    throw new Error(error || 'No data returned')
  }
  
  return data
}
