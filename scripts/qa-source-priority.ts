
import { selectBestSource, ChapterSource, SeriesSourcePreference } from '../src/lib/source-utils-shared';

const mockSources: ChapterSource[] = [
  {
    id: '1',
    source_name: 'mangadex',
    source_id: 'md-1',
    chapter_url: 'https://mangadex.org/chapter/1',
    published_at: '2024-01-01T00:00:00Z',
    discovered_at: '2024-01-01T00:00:00Z',
    is_available: true,
    trust_score: 5.0
  },
  {
    id: '2',
    source_name: 'mangasee',
    source_id: 'ms-1',
    chapter_url: 'https://mangasee123.com/chapter/1',
    published_at: '2024-01-01T01:00:00Z',
    discovered_at: '2024-01-01T01:00:00Z',
    is_available: true,
    trust_score: 4.5
  },
  {
    id: '3',
    source_name: 'mangatown',
    source_id: 'mt-1',
    chapter_url: 'https://mangatown.com/chapter/1',
    published_at: '2024-01-01T02:00:00Z',
    discovered_at: '2024-01-01T02:00:00Z',
    is_available: true,
    trust_score: 3.0
  }
];

const seriesSources: SeriesSourcePreference[] = [
  { id: 's1', source_name: 'mangadex', trust_score: 5.0 },
  { id: 's2', source_name: 'mangasee', trust_score: 4.5 },
  { id: 's3', source_name: 'mangatown', trust_score: 3.0 }
];

function runTest(name: string, fn: () => void) {
  console.log(`\n--- Running Test: ${name} ---`);
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    process.exit(1);
  }
}

// Test Case 1: Chapter available on 3 sources, default open uses highest-priority source
runTest('TC1: Highest priority source is selected', () => {
  const preferences = {
    preferredSourcePriorities: ['mangasee', 'mangadex', 'mangatown']
  };
  const result = selectBestSource(mockSources, seriesSources, preferences);
  
  if (result.source?.source_name !== 'mangasee') {
    throw new Error(`Expected mangasee, got ${result.source?.source_name}`);
  }
  if (result.reason !== 'preferred_global') {
    throw new Error(`Expected reason preferred_global, got ${result.reason}`);
  }
});

// Test Case 2: User changes priority order
runTest('TC2: Respects updated priority order', () => {
  const preferences = {
    preferredSourcePriorities: ['mangatown', 'mangasee', 'mangadex']
  };
  const result = selectBestSource(mockSources, seriesSources, preferences);
  
  if (result.source?.source_name !== 'mangatown') {
    throw new Error(`Expected mangatown, got ${result.source?.source_name}`);
  }
});

// Test Case 3: Preferred source unavailable fallback
runTest('TC3: Falls back to next available source if preferred is unavailable', () => {
  const sourcesWithUnavailable = mockSources.map(s => 
    s.source_name === 'mangadex' ? { ...s, is_available: false } : s
  );
  
  const preferences = {
    preferredSourcePriorities: ['mangadex', 'mangasee', 'mangatown']
  };
  const result = selectBestSource(sourcesWithUnavailable, seriesSources, preferences);
  
  if (result.source?.source_name !== 'mangasee') {
    throw new Error(`Expected mangasee, got ${result.source?.source_name}`);
  }
});

// Test Case 3.1: Fallback to trust score if no priorities match
runTest('TC3.1: Falls back to trust score if no priorities match', () => {
  const preferences = {
    preferredSourcePriorities: ['unknown-source']
  };
  const result = selectBestSource(mockSources, seriesSources, preferences);
  
  if (result.source?.source_name !== 'mangadex') { // highest trust score
    throw new Error(`Expected mangadex (highest trust), got ${result.source?.source_name}`);
  }
  if (result.reason !== 'trust_score') {
    throw new Error(`Expected reason trust_score, got ${result.reason}`);
  }
});

// Test Case 4: Case-insensitive matching
runTest('TC4: Case-insensitive matching', () => {
  const sources = [
    { ...mockSources[0], source_name: 'MangaDex' }
  ];
  const preferences = {
    preferredSourcePriorities: ['mangadex']
  };
  const result = selectBestSource(sources, seriesSources, preferences);
  
  if (result.source?.source_name !== 'MangaDex') {
    throw new Error(`Expected MangaDex, got ${result.source?.source_name}`);
  }
});

console.log('\nAll source selection logic tests PASSED.');

