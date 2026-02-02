import { selectBestSource, sortSourcesByPriority } from '../../lib/source-utils-shared'

describe('Series Source Preference Logic', () => {
  const sources = [
    { id: '1', source_name: 'MangaDex', source_id: 'md1', source_chapter_url: 'url1', discovered_at: '2023-01-01', is_available: true },
    { id: '2', source_name: 'MangaPark', source_id: 'mp1', source_chapter_url: 'url2', discovered_at: '2023-01-02', is_available: true },
    { id: '3', source_name: 'MangaSee', source_id: 'ms1', source_chapter_url: 'url3', discovered_at: '2022-12-01', is_available: true },
  ]

  test('D7/D8: Override source for series A vs Global preference', () => {
    const preferencesA = {
      preferredSourceSeries: 'MangaPark',
      preferredSourcePriorities: ['MangaDex', 'MangaSee']
    }

    const resultA = selectBestSource(sources, [], preferencesA)
    expect(resultA.source?.source_name).toBe('MangaPark')
    expect(resultA.reason).toBe('preferred_series')

    const preferencesB = {
      preferredSourceSeries: null,
      preferredSourcePriorities: ['MangaDex', 'MangaSee']
    }

    const resultB = selectBestSource(sources, [], preferencesB)
    expect(resultB.source?.source_name).toBe('MangaDex')
    expect(resultB.reason).toBe('priority_list')
  })

  test('A1/A2/A3: Source Fallback logic', () => {
    // 1. Preferred source is unavailable
    const sourcesWithFailure = [
      { ...sources[0], is_available: false }, // MangaDex unavailable
      sources[1], // MangaPark
      sources[2], // MangaSee
    ]

    const preferences = {
      preferredSourceSeries: 'MangaDex',
      preferredSourcePriorities: ['MangaPark', 'MangaSee']
    }

    const result = selectBestSource(sourcesWithFailure, [], preferences)
    // Should skip MangaDex and pick next in priority (MangaPark)
    expect(result.source?.source_name).toBe('MangaPark')
    expect(result.reason).toBe('priority_list')
    expect(result.isFallback).toBe(true)
  })

  test('Fallback to oldest discovery if no preferences match', () => {
    const result = selectBestSource(sources, [], {
      preferredSourceSeries: null,
      preferredSourcePriorities: []
    })
    // MangaSee was discovered in 2022-12-01 (oldest)
    expect(result.source?.source_name).toBe('MangaSee')
    expect(result.reason).toBe('discovered_first')
  })
})
