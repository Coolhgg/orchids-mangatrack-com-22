
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!

const API_URL = 'http://localhost:3000/api/series/browse'

interface SeriesResult {
  id: string;
  title: string;
}

interface BrowseResponse {
  results: SeriesResult[];
  next_cursor?: string;
  filters_applied: {
    sort: string;
  };
}

async function testSort(sort: string) {
  console.log(`Testing sort: ${sort}`)
  const url = `${API_URL}?sort=${sort}&limit=5`
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok) {
      console.error(`Sort ${sort} failed:`, data)
      return null
    }
    return data.results
  } catch (err) {
    console.error(`Sort ${sort} error:`, err)
    return null
  }
}

async function verify() {
  const sorts = ['latest_chapter', 'popularity', 'score', 'newest']
  
  for (const sort of sorts) {
    console.log(`\n--- Testing sort: ${sort} ---`)
    const url = `${API_URL}?sort=${sort}&limit=5`
    const res = await fetch(url)
    const data: BrowseResponse = await res.json()
    
    if (data.results && data.results.length > 0) {
      console.log(`Page 1 IDs: ${data.results.map((r: SeriesResult) => r.id.substring(0, 8)).join(', ')}`)
      console.log(`Page 1 first: ${data.results[0].title}`)
      
      if (data.next_cursor) {
        const nextUrl = `${API_URL}?sort=${sort}&limit=5&cursor=${data.next_cursor}`
        console.log(`Next URL: ${nextUrl}`)
        const nextRes = await fetch(nextUrl)
        const nextData: BrowseResponse = await nextRes.json()
        if (nextData.results && nextData.results.length > 0) {
          console.log(`Page 2 IDs: ${nextData.results.map((r: SeriesResult) => r.id.substring(0, 8)).join(', ')}`)
          console.log(`Page 2 first: ${nextData.results[0]?.title}`)
          console.log(`Cursor stable: ${nextData.results[0]?.id !== data.results[0].id}`)
        } else {
          console.log('Page 2 empty')
        }
      }
    }
  }

  // Section 4: Search + Sort
  console.log('\n--- Section 4: Search + Sort ---')
  const searchRes = await fetch(`${API_URL}?q=manga&limit=1`)
  const searchData: BrowseResponse = await searchRes.json()
  console.log(`Search default sort: ${searchData.filters_applied.sort} (Expected: popularity)`)

  const searchManualRes = await fetch(`${API_URL}?q=manga&sort=newest&limit=1`)
  const searchManualData = await searchManualRes.json()
  console.log(`Search manual sort: ${searchManualData.filters_applied.sort} (Expected: newest)`)

  // Section 5: Filter + Sort
  console.log('\n--- Section 5: Filter + Sort ---')
  const filterRes = await fetch(`${API_URL}?genres=Action&sort=score&limit=1`)
  const filterData = await filterRes.json()
  console.log(`Filter + Sort: ${filterData.results[0]?.title} (Sort: ${filterData.filters_applied.sort}, Genre: ${filterData.filters_applied.genres[0]})`)
}

verify()
