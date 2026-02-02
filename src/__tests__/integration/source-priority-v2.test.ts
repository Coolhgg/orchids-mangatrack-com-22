import { selectBestSource, ChapterSource, SeriesSourcePreference } from '../../lib/source-utils-shared';

describe('Source Priority Integration Tests', () => {
  const mockSources: ChapterSource[] = [
    {
      id: '1',
      source_name: 'MangaDex',
      source_id: 'md-1',
      chapter_url: 'https://mangadex.org/chapter/1',
      published_at: '2024-01-01T00:00:00Z',
      discovered_at: '2024-01-01T00:00:00Z',
      is_available: true,
      trust_score: 5.0
    },
    {
      id: '2',
      source_name: 'MangaSee',
      source_id: 'ms-1',
      chapter_url: 'https://mangasee123.com/chapter/1',
      published_at: '2024-01-01T01:00:00Z',
      discovered_at: '2024-01-01T01:00:00Z',
      is_available: true,
      trust_score: 4.5
    },
    {
      id: '3',
      source_name: 'MangaTown',
      source_id: 'mt-1',
      chapter_url: 'https://mangatown.com/chapter/1',
      published_at: '2024-01-01T02:00:00Z',
      discovered_at: '2024-01-01T02:00:00Z',
      is_available: true,
      trust_score: 3.0
    }
  ];

  const seriesSources: SeriesSourcePreference[] = [
    { id: 's1', source_name: 'MangaDex', trust_score: 5.0 },
    { id: 's2', source_name: 'MangaSee', trust_score: 4.5 },
    { id: 's3', source_name: 'MangaTown', trust_score: 3.0 }
  ];

  test('TC1: Highest priority source is selected when multiple are available', () => {
    const preferences = {
      preferredSourcePriorities: ['mangasee', 'mangadex', 'mangatown']
    };
    const result = selectBestSource(mockSources, seriesSources, preferences);
    
    expect(result.source?.source_name).toBe('MangaSee');
    expect(result.reason).toBe('preferred_global');
  });

  test('TC2: Respects priority order changes', () => {
    const preferences = {
      preferredSourcePriorities: ['mangatown', 'mangasee', 'mangadex']
    };
    const result = selectBestSource(mockSources, seriesSources, preferences);
    
    expect(result.source?.source_name).toBe('MangaTown');
  });

  test('TC3: Falls back to next available source when preferred is unavailable', () => {
    const sourcesWithUnavailable = mockSources.map(s => 
      s.source_name === 'MangaDex' ? { ...s, is_available: false } : s
    );
    
    const preferences = {
      preferredSourcePriorities: ['mangadex', 'mangasee', 'mangatown']
    };
    const result = selectBestSource(sourcesWithUnavailable, seriesSources, preferences);
    
    expect(result.source?.source_name).toBe('MangaSee');
  });

  test('TC4: Case-insensitive matching works correctly', () => {
    const preferences = {
      preferredSourcePriorities: ['MANGADEX']
    };
    const result = selectBestSource(mockSources, seriesSources, preferences);
    
    expect(result.source?.source_name).toBe('MangaDex');
  });

  test('TC5: Fallback to trust score if no priorities match', () => {
    const preferences = {
      preferredSourcePriorities: ['non-existent']
    };
    const result = selectBestSource(mockSources, seriesSources, preferences);
    
    expect(result.source?.source_name).toBe('MangaDex'); // Highest trust
    expect(result.reason).toBe('trust_score');
  });

  test('TC6: Series-specific preference overrides global priority', () => {
    const preferences = {
      preferredSourceSeries: 'MangaTown',
      preferredSourcePriorities: ['MangaDex', 'MangaSee']
    };
    const result = selectBestSource(mockSources, seriesSources, preferences);
    
    expect(result.source?.source_name).toBe('MangaTown');
    expect(result.reason).toBe('preferred_series');
  });

  test('TC7: Legacy global fallback if priority list is empty', () => {
    const preferences = {
      preferredSourceGlobal: 'MangaSee',
      preferredSourcePriorities: []
    };
    const result = selectBestSource(mockSources, seriesSources, preferences);
    
    expect(result.source?.source_name).toBe('MangaSee');
    expect(result.reason).toBe('preferred_global');
  });
});
