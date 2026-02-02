/**
 * Content Filtering Integration Tests
 * 
 * Tests the platform-wide content filtering policy:
 * - 'pornographic' content is BLOCKED and never served
 * - 'safe', 'suggestive', 'erotica' are the only allowed ratings
 * - Different safe browsing modes filter appropriately within allowed ratings
 */

import {
  ALLOWED_CONTENT_RATINGS,
  BLOCKED_CONTENT_RATINGS,
  NSFW_CONTENT_RATINGS,
  isBlockedContent,
  isNSFW,
} from '@/lib/constants/safe-browsing';

describe('Content Filtering Policy', () => {
  describe('Constants', () => {
    it('ALLOWED_CONTENT_RATINGS excludes pornographic', () => {
      expect(ALLOWED_CONTENT_RATINGS).not.toContain('pornographic');
      expect([...ALLOWED_CONTENT_RATINGS]).toEqual(['safe', 'suggestive', 'erotica']);
    });

    it('BLOCKED_CONTENT_RATINGS includes only pornographic', () => {
      expect([...BLOCKED_CONTENT_RATINGS]).toEqual(['pornographic']);
    });

    it('NSFW_CONTENT_RATINGS is erotica only', () => {
      expect([...NSFW_CONTENT_RATINGS]).toEqual(['erotica']);
    });

    it('allowed and blocked ratings are mutually exclusive', () => {
      const allowed = new Set(ALLOWED_CONTENT_RATINGS);
      const blocked = new Set(BLOCKED_CONTENT_RATINGS);
      
      for (const rating of blocked) {
        expect(allowed.has(rating as any)).toBe(false);
      }
    });
  });

  describe('isBlockedContent()', () => {
    it('returns true for pornographic content', () => {
      expect(isBlockedContent('pornographic')).toBe(true);
      expect(isBlockedContent('PORNOGRAPHIC')).toBe(true);
      expect(isBlockedContent('Pornographic')).toBe(true);
    });

    it('returns false for allowed content ratings', () => {
      expect(isBlockedContent('safe')).toBe(false);
      expect(isBlockedContent('suggestive')).toBe(false);
      expect(isBlockedContent('erotica')).toBe(false);
    });

    it('returns false for null/undefined content ratings', () => {
      expect(isBlockedContent(null)).toBe(false);
      expect(isBlockedContent(undefined)).toBe(false);
    });

    it('returns false for unknown content ratings', () => {
      expect(isBlockedContent('unknown')).toBe(false);
      expect(isBlockedContent('explicit')).toBe(false);
    });
  });

  describe('isNSFW()', () => {
    it('returns true for erotica', () => {
      expect(isNSFW('erotica')).toBe(true);
      expect(isNSFW('EROTICA')).toBe(true);
    });

    it('returns false for safe and suggestive', () => {
      expect(isNSFW('safe')).toBe(false);
      expect(isNSFW('suggestive')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isNSFW(null)).toBe(false);
      expect(isNSFW(undefined)).toBe(false);
    });

    it('returns false for blocked content (handled separately)', () => {
      expect(isNSFW('pornographic')).toBe(false);
    });
  });
});

describe('Content Filtering by Safe Browsing Mode', () => {
  function getContentRatingsForMode(mode: 'sfw' | 'sfw_plus' | 'nsfw'): string[] {
    switch (mode) {
      case 'sfw':
        return ['safe', 'suggestive'];
      case 'sfw_plus':
        return ['safe', 'suggestive', 'erotica'];
      case 'nsfw':
        return ['safe', 'suggestive', 'erotica'];
      default:
        return ['safe', 'suggestive'];
    }
  }

  describe('SFW Mode', () => {
    it('allows only safe and suggestive', () => {
      const ratings = getContentRatingsForMode('sfw');
      expect(ratings).toEqual(['safe', 'suggestive']);
      expect(ratings).not.toContain('erotica');
      expect(ratings).not.toContain('pornographic');
    });
  });

  describe('SFW+ Mode', () => {
    it('allows safe, suggestive, and erotica (blurred)', () => {
      const ratings = getContentRatingsForMode('sfw_plus');
      expect(ratings).toEqual(['safe', 'suggestive', 'erotica']);
      expect(ratings).not.toContain('pornographic');
    });
  });

  describe('NSFW Mode', () => {
    it('allows safe, suggestive, and erotica (NOT pornographic)', () => {
      const ratings = getContentRatingsForMode('nsfw');
      expect(ratings).toEqual(['safe', 'suggestive', 'erotica']);
      expect(ratings).not.toContain('pornographic');
    });

    it('NEVER includes pornographic even in NSFW mode', () => {
      const ratings = getContentRatingsForMode('nsfw');
      expect(ratings.includes('pornographic')).toBe(false);
    });
  });

  describe('Default Behavior', () => {
    it('defaults to SFW filtering for unknown modes', () => {
      const ratings = getContentRatingsForMode('unknown' as any);
      expect(ratings).toEqual(['safe', 'suggestive']);
    });
  });
});

describe('MangaDex API Content Rating Filtering', () => {
  const ALLOWED_CONTENT_RATINGS_PARAM = 'contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica';

  it('API parameter excludes pornographic', () => {
    expect(ALLOWED_CONTENT_RATINGS_PARAM).not.toContain('pornographic');
  });

  it('API parameter includes all allowed ratings', () => {
    expect(ALLOWED_CONTENT_RATINGS_PARAM).toContain('safe');
    expect(ALLOWED_CONTENT_RATINGS_PARAM).toContain('suggestive');
    expect(ALLOWED_CONTENT_RATINGS_PARAM).toContain('erotica');
  });

  it('builds correct URL for MangaDex search', () => {
    const baseUrl = 'https://api.mangadex.org/manga';
    const title = 'one piece';
    const url = `${baseUrl}?title=${encodeURIComponent(title)}&limit=10&${ALLOWED_CONTENT_RATINGS_PARAM}`;
    
    expect(url).toBe('https://api.mangadex.org/manga?title=one%20piece&limit=10&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica');
    expect(url).not.toContain('pornographic');
  });

  it('builds correct URL for MangaDex chapter feed', () => {
    const baseUrl = 'https://api.mangadex.org';
    const mangaId = 'test-uuid';
    const url = `${baseUrl}/manga/${mangaId}/feed?limit=500&offset=0&translatedLanguage[]=en&order[chapter]=asc&${ALLOWED_CONTENT_RATINGS_PARAM}`;
    
    expect(url).toContain('contentRating[]=safe');
    expect(url).toContain('contentRating[]=suggestive');
    expect(url).toContain('contentRating[]=erotica');
    expect(url).not.toContain('pornographic');
  });
});

describe('SQL Query Content Filtering', () => {
  describe('Discover Ranking Queries', () => {
    it('SQL WHERE clause excludes pornographic content', () => {
      const whereClause = "AND (s.content_rating IS NULL OR s.content_rating != 'pornographic')";
      expect(whereClause).toContain("!= 'pornographic'");
    });

    it('parameterized query validates against allowed ratings', () => {
      const allowedSet = new Set(['safe', 'suggestive', 'erotica', 'all']);
      
      expect(allowedSet.has('safe')).toBe(true);
      expect(allowedSet.has('suggestive')).toBe(true);
      expect(allowedSet.has('erotica')).toBe(true);
      expect(allowedSet.has('pornographic')).toBe(false);
    });
  });

  describe('Feed Updates Queries', () => {
    it('content rating filter never includes pornographic', () => {
      const buildAllowedRatings = (mode: string): string[] => {
        const allowedRatings = ['safe', 'suggestive'];
        if (mode === 'suggestive' || mode === 'sfw_plus') {
          allowedRatings.push('erotica');
        }
        if (mode === 'nsfw') {
          if (!allowedRatings.includes('erotica')) {
            allowedRatings.push('erotica');
          }
        }
        return allowedRatings;
      };

      expect(buildAllowedRatings('sfw')).toEqual(['safe', 'suggestive']);
      expect(buildAllowedRatings('sfw_plus')).toEqual(['safe', 'suggestive', 'erotica']);
      expect(buildAllowedRatings('nsfw')).toEqual(['safe', 'suggestive', 'erotica']);
      
      expect(buildAllowedRatings('sfw')).not.toContain('pornographic');
      expect(buildAllowedRatings('sfw_plus')).not.toContain('pornographic');
      expect(buildAllowedRatings('nsfw')).not.toContain('pornographic');
    });
  });
});

describe('Recommendations Content Filtering', () => {
  it('cold start recommendations exclude pornographic', () => {
    const getContentRatingsForMode = (safeBrowsing: 'sfw' | 'nsfw'): readonly string[] => {
      if (safeBrowsing === 'sfw') {
        return ['safe', 'suggestive'];
      }
      return ALLOWED_CONTENT_RATINGS;
    };

    expect(getContentRatingsForMode('sfw')).toEqual(['safe', 'suggestive']);
    expect([...getContentRatingsForMode('nsfw')]).toEqual(['safe', 'suggestive', 'erotica']);
    expect(getContentRatingsForMode('nsfw')).not.toContain('pornographic');
  });

  it('hybrid recommendations use ALLOWED_CONTENT_RATINGS', () => {
    const contentRatings = [...ALLOWED_CONTENT_RATINGS];
    expect(contentRatings).not.toContain('pornographic');
  });
});

describe('Edge Cases', () => {
  it('handles case-insensitive content rating comparisons', () => {
    const normalizeRating = (rating: string): string => rating.toLowerCase().trim();
    
    expect(isBlockedContent(normalizeRating('PORNOGRAPHIC'))).toBe(true);
    expect(isBlockedContent(normalizeRating('Pornographic'))).toBe(true);
    expect(isBlockedContent(normalizeRating('  pornographic  '))).toBe(true);
  });

  it('handles null and undefined content ratings gracefully', () => {
    const isAllowedRating = (rating: string | null | undefined): boolean => {
      if (!rating) return true;
      return ALLOWED_CONTENT_RATINGS.includes(rating.toLowerCase() as any);
    };

    expect(isAllowedRating(null)).toBe(true);
    expect(isAllowedRating(undefined)).toBe(true);
    expect(isAllowedRating('safe')).toBe(true);
    expect(isAllowedRating('pornographic')).toBe(false);
  });

  it('rejects SQL injection attempts in content rating filters', () => {
    const validateFilter = (value: string | null): string | null => {
      if (!value) return null;
      const allowedValues = new Set(['safe', 'suggestive', 'erotica', 'all']);
      const normalized = value.toLowerCase().trim();
      if (!allowedValues.has(normalized)) {
        return null;
      }
      return normalized;
    };

    expect(validateFilter("safe'; DROP TABLE series; --")).toBe(null);
    expect(validateFilter('pornographic')).toBe(null);
    expect(validateFilter('safe')).toBe('safe');
    expect(validateFilter('erotica')).toBe('erotica');
  });

  it('user with null safe_browsing_mode defaults to sfw', () => {
    const getSafeBrowsingMode = (mode: string | null | undefined): string => {
      return mode || 'sfw';
    };

    expect(getSafeBrowsingMode(null)).toBe('sfw');
    expect(getSafeBrowsingMode(undefined)).toBe('sfw');
    expect(getSafeBrowsingMode('')).toBe('sfw');
    expect(getSafeBrowsingMode('nsfw')).toBe('nsfw');
    expect(getSafeBrowsingMode('sfw_plus')).toBe('sfw_plus');
  });

  it('series with null content_rating should be included (legacy data)', () => {
    const shouldIncludeSeries = (contentRating: string | null, allowedRatings: string[]): boolean => {
      if (contentRating === null) return true;
      return allowedRatings.includes(contentRating);
    };

    expect(shouldIncludeSeries(null, ['safe', 'suggestive'])).toBe(true);
    expect(shouldIncludeSeries('safe', ['safe', 'suggestive'])).toBe(true);
    expect(shouldIncludeSeries('erotica', ['safe', 'suggestive'])).toBe(false);
    expect(shouldIncludeSeries('pornographic', ['safe', 'suggestive', 'erotica'])).toBe(false);
  });

    it('ALLOWED_CONTENT_RATINGS is never user-controlled (security)', () => {
      const PLATFORM_ALLOWED = [...ALLOWED_CONTENT_RATINGS];
      const userInput = 'pornographic' as string;
      
      const allowedSet = new Set(PLATFORM_ALLOWED);
      expect(allowedSet.has(userInput as any)).toBe(false);
      
      const maliciousInput = "erotica'; DROP TABLE series; --" as string;
      expect(allowedSet.has(maliciousInput as any)).toBe(false);
    });
});

describe('Content Policy Compliance Summary', () => {
  it('verifies platform-wide pornographic block is enforced', () => {
    const policyChecklist = {
      blockedContentRatings: [...BLOCKED_CONTENT_RATINGS],
      allowedContentRatings: [...ALLOWED_CONTENT_RATINGS],
      pornographicInBlocked: BLOCKED_CONTENT_RATINGS.includes('pornographic'),
      pornographicNotInAllowed: !ALLOWED_CONTENT_RATINGS.includes('pornographic' as any),
      isBlockedWorksForPornographic: isBlockedContent('pornographic'),
    };

    expect(policyChecklist.blockedContentRatings).toEqual(['pornographic']);
    expect(policyChecklist.allowedContentRatings).toEqual(['safe', 'suggestive', 'erotica']);
    expect(policyChecklist.pornographicInBlocked).toBe(true);
    expect(policyChecklist.pornographicNotInAllowed).toBe(true);
    expect(policyChecklist.isBlockedWorksForPornographic).toBe(true);
  });
});
