
import { normalize } from '../src/lib/search-intent';
import { MANGADEX_API_BASE, getMangaDexHeaders } from '../src/lib/mangadex';

async function testSearch(query: string) {
  console.log(`Testing search for: "${query}"`);
  const normalized = normalize(query);
  console.log(`Normalized query: "${normalized}"`);

  const url = new URL(`${MANGADEX_API_BASE}/manga`);
  url.searchParams.set('title', query);
  url.searchParams.set('limit', '5');
  url.searchParams.append('includes[]', 'cover_art');
  url.searchParams.append('contentRating[]', 'safe');
  url.searchParams.append('contentRating[]', 'suggestive');
  url.searchParams.append('contentRating[]', 'erotica');
  url.searchParams.append('contentRating[]', 'pornographic');

  console.log(`Fetching: ${url.toString()}`);
  
  try {
    const response = await fetch(url.toString(), { 
        headers: {
            'User-Agent': 'Orchids-Debug-Agent/1.0',
            ...getMangaDexHeaders()
        }
    });
    console.log(`Response status: ${response.status}`);
    
    if (!response.ok) {
      const text = await response.text();
      console.log(`Response body: ${text}`);
      return;
    }

    const data = await response.json();
    console.log(`Found ${data.data.length} results`);
    
    data.data.forEach((manga: any) => {
      console.log(`- ${manga.attributes.title.en || Object.values(manga.attributes.title)[0]} (ID: ${manga.id})`);
      console.log(`  Content Rating: ${manga.attributes.contentRating}`);
    });
  } catch (error) {
    console.error('Error during fetch:', error);
  }
}

const query = "Isekai wa Smartphone to Tomo ni";
testSearch(query);
