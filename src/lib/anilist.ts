// src/lib/anilist.ts

const ANILIST_TIMEOUT_MS = 15000;

export interface AniListExternalLink {
  url: string;
  site: string;
  isDisabled: boolean;
  type: 'INFO' | 'STREAMING' | 'SOCIAL';
}

export async function getOfficialLinks(anilistId: number | string): Promise<AniListExternalLink[]> {
  const query = `
    query ($id: Int) {
      Media (id: $id, type: MANGA) {
        externalLinks {
          url
          site
          isDisabled
          type
        }
      }
    }
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANILIST_TIMEOUT_MS);

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ 
        query, 
        variables: { id: typeof anilistId === 'string' ? parseInt(anilistId, 10) : anilistId } 
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      // AniList has a 90 requests per minute rate limit
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
      console.warn(`[AniList] Rate limited. Retrying after ${retryAfter}s...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return getOfficialLinks(anilistId);
    }

    if (!response.ok) {
      console.error(`[AniList] API error: ${response.status}`);
      return [];
    }

    const { data, errors } = await response.json();
    
    if (errors) {
      console.error(`[AniList] GraphQL errors:`, errors);
      return [];
    }

    return (data?.Media?.externalLinks || [])
      .filter((link: any) => !link.isDisabled);
  } catch (error) {
    console.error(`[AniList] Error fetching links for ${anilistId}:`, error);
    return [];
  }
}

export async function getOfficialLinksBySearch(title: string): Promise<AniListExternalLink[]> {
  const query = `
    query ($search: String) {
      Media (search: $search, type: MANGA) {
        id
        title {
          romaji
          english
        }
        externalLinks {
          url
          site
          isDisabled
          type
        }
      }
    }
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANILIST_TIMEOUT_MS);

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { search: title }
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
      console.warn(`[AniList] Rate limited. Retrying after ${retryAfter}s...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return getOfficialLinksBySearch(title);
    }

    if (!response.ok) {
      console.error(`[AniList] API error for search "${title}": ${response.status}`);
      return [];
    }

    const { data, errors } = await response.json();

    if (errors) {
      console.error(`[AniList] GraphQL errors for search "${title}":`, errors);
      return [];
    }

    return (data?.Media?.externalLinks || [])
      .filter((link: any) => !link.isDisabled);
  } catch (error) {
    console.error(`[AniList] Error searching links for "${title}":`, error);
    return [];
  }
}
