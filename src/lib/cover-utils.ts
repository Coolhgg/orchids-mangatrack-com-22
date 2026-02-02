export const SOURCE_PRIORITY: Record<string, number> = {
  mangadex: 10,
  mangapark: 5,
};

const VALID_COVER_DOMAINS = [
  'uploads.mangadex.org/covers/',
  'mangapark.net/covers/',
  'mangapark.io/covers/',
];

const PLACEHOLDER_PATTERNS = [
  'unsplash.com',
  'placeholder',
  'static/img',
  'static/images',
  'mangadex.org/static',
  'avatar',
  'logo',
  'default',
  'you can read this',
  'read this at',
  'no-image',
  'image-not-found',
  'manga-placeholder',
  'no-cover',
  'attribution',
];

const MANGADEX_PLACEHOLDER_FILENAMES = [
  'placeholder',
  'no-cover',
  'no_cover',
  'missing',
];

const MIN_MANGADEX_FILENAME_LENGTH = 10;

export function isValidCoverUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  const lowerUrl = url.toLowerCase();

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (lowerUrl.includes(pattern)) return false;
  }

  for (const domain of VALID_COVER_DOMAINS) {
    if (url.includes(domain)) {
      if (domain === 'uploads.mangadex.org/covers/') {
        const parts = url.split('/');
        if (parts.length < 6) return false;

        const fileName = parts[parts.length - 1];
        if (!fileName || fileName.length < MIN_MANGADEX_FILENAME_LENGTH) return false;

        const fileNameLower = fileName.toLowerCase();
        for (const placeholder of MANGADEX_PLACEHOLDER_FILENAMES) {
          if (fileNameLower.includes(placeholder)) return false;
        }

        if (!/\.(jpg|jpeg|png|gif|webp)/i.test(fileName)) return false;
      }
      return true;
    }
  }

  return false;
}

export function isMangaDexPlaceholder(url: string | null | undefined): boolean {
  if (!url) return true;
  if (!url.includes('uploads.mangadex.org/covers/')) return false;

  const parts = url.split('/');
  if (parts.length < 6) return true;

  const fileName = parts[parts.length - 1];
  if (!fileName || fileName.length < MIN_MANGADEX_FILENAME_LENGTH) return true;

  const fileNameLower = fileName.toLowerCase();
  for (const placeholder of MANGADEX_PLACEHOLDER_FILENAMES) {
    if (fileNameLower.includes(placeholder)) return true;
  }

  if (!/\.(jpg|jpeg|png|gif|webp)/i.test(fileName)) return true;

  return false;
}

export type CoverSize = 'original' | '256' | '512' | '1024';

export function getOptimizedCoverUrl(
  url: string | null | undefined,
  size: CoverSize = 'original'
): string | null {
  if (!url) return null;
  if (size === 'original') return url;

  // MangaDex optimization
  if (url.includes('uploads.mangadex.org/covers/')) {
    // Remove any existing suffix (.256.jpg, .512.jpg, .1024.jpg) before adding the new one
    const baseUrl = url.replace(/\.(256|512|1024)\.jpg$/, '');
    return `${baseUrl}.${size}.jpg`;
  }

  return url;
}

export interface CoverResult {
  cover_url: string;
  source_name: string;
  cover_width?: number | null;
  cover_height?: number | null;
}

export function selectBestCover(
  sources: Array<{
    source_name: string;
    cover_url: string | null;
    cover_width?: number | null;
    cover_height?: number | null;
    cover_updated_at?: Date | string | null;
    is_primary_cover?: boolean;
  }>
): CoverResult | null {
  const withValidCovers = sources.filter((s) => isValidCoverUrl(s.cover_url));

  if (withValidCovers.length === 0) return null;

  const ranked = withValidCovers.sort((a, b) => {
    if (a.is_primary_cover !== b.is_primary_cover) {
      return a.is_primary_cover ? -1 : 1;
    }

    const aPrio = SOURCE_PRIORITY[a.source_name] ?? 1;
    const bPrio = SOURCE_PRIORITY[b.source_name] ?? 1;
    if (aPrio !== bPrio) return bPrio - aPrio;

    const aRes = (a.cover_width ?? 0) * (a.cover_height ?? 0);
    const bRes = (b.cover_width ?? 0) * (b.cover_height ?? 0);
    if (aRes !== bRes) return bRes - aRes;

    const aTime = a.cover_updated_at ? new Date(a.cover_updated_at).getTime() : 0;
    const bTime = b.cover_updated_at ? new Date(b.cover_updated_at).getTime() : 0;
    
    return bTime - aTime;
  });

  const best = ranked[0];
  return {
    cover_url: best.cover_url!,
    source_name: best.source_name,
    cover_width: best.cover_width,
    cover_height: best.cover_height,
  };
}
