import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables:')
  console.error('NEXT_PUBLIC_SUPABASE_URL:', SUPABASE_URL ? 'present' : 'missing')
  console.error('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_KEY ? 'present' : 'missing')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface MangaDexTag {
  attributes: {
    name: { en?: string }
    group: string
  }
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchTagsFromMangaDex(mangadexId: string): Promise<string[]> {
  const url = `https://api.mangadex.org/manga/${mangadexId}?includes[]=tag`
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MangaTrack/1.0 (manga-tracker)'
      }
    })
    
    if (!response.ok) {
      if (response.status === 429) {
        console.log('Rate limited, waiting 30 seconds...')
        await delay(30000)
        return fetchTagsFromMangaDex(mangadexId)
      }
      console.error(`Failed to fetch ${mangadexId}: ${response.status}`)
      return []
    }
    
    const data = await response.json()
    const attrs = data.data?.attributes
    
    if (!attrs?.tags) return []
    
    // Extract themes (group === 'theme')
    const tags = (attrs.tags as MangaDexTag[])
      .filter(tag => tag.attributes?.group === 'theme')
      .map(tag => tag.attributes?.name?.en || '')
      .filter(Boolean)
    
    return tags
  } catch (error) {
    console.error(`Error fetching ${mangadexId}:`, error)
    return []
  }
}

async function backfillTags() {
  console.log('Starting tags backfill...')
  console.log('Supabase URL:', SUPABASE_URL)
  
  // Get all series with mangadex_id but no tags
  const { data: series, error } = await supabase
    .from('series')
    .select('id, title, mangadex_id, tags')
    .not('mangadex_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)
  
  if (error) {
    console.error('Error fetching series:', error)
    return
  }
  
  console.log(`Found ${series?.length || 0} series with mangadex_id`)
  
  let updated = 0
  let skipped = 0
  let failed = 0
  
  for (const s of series || []) {
    // Skip if already has tags
    if (s.tags && Array.isArray(s.tags) && s.tags.length > 0) {
      skipped++
      continue
    }
    
    console.log(`[${updated + skipped + failed + 1}/${series?.length}] Fetching tags for: ${s.title}`)
    
    const tags = await fetchTagsFromMangaDex(s.mangadex_id!)
    
    if (tags.length > 0) {
      const { error: updateError } = await supabase
        .from('series')
        .update({ tags })
        .eq('id', s.id)
      
      if (updateError) {
        console.error(`  Failed to update:`, updateError.message)
        failed++
      } else {
        console.log(`  -> Tags: ${tags.join(', ')}`)
        updated++
      }
    } else {
      console.log(`  -> No tags found`)
      skipped++
    }
    
    // Rate limiting: 1 request per 500ms
    await delay(500)
  }
  
  console.log('\nBackfill complete!')
  console.log(`Updated: ${updated}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Failed: ${failed}`)
}

backfillTags()
