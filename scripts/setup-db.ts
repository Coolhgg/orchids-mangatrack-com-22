
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function setup() {
  console.log('Verifying database tables...')
  
  const tables = [
    'users', 'series', 'series_sources', 'chapters', 'library_entries', 
    'notifications', 'achievements', 'user_achievements', 'follows', 
    'activities', 'import_jobs'
  ]
  
  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1)
    if (error) {
      console.error('Table ' + table + ' might be missing: ' + error.message)
    } else {
      console.log('Table ' + table + ' verified.')
    }
  }

  // Check RPC
  const { error: rpcError } = await supabase.rpc('increment_xp', { user_id: '00000000-0000-0000-0000-000000000000', amount: 0 })
  if (rpcError && rpcError.message.includes('function rpc.increment_xp() does not exist')) {
    console.error('RPC increment_xp is missing.')
  } else if (rpcError) {
     // uuid 0 doesn't exist so we expect some error but not "does not exist"
     if (rpcError.message.includes('does not exist')) {
         console.error('RPC increment_xp is missing: ' + rpcError.message)
     } else {
         console.log('RPC increment_xp verified (UUID error expected).')
     }
  } else {
    console.log('RPC increment_xp verified.')
  }
}

setup()
