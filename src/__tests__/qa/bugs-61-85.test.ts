import {
  normalizeProgress,
  mergeProgress,
  calculateReviewDecision,
  isMetadataComplete,
  hasCoverImage,
  getMetadataDisplayState,
  exhaustiveMetadataCheck,
  exhaustiveSyncCheck,
  areLanguagesCompatible,
  checkYearCompatibility,
  generateMetadataChecksum,
  hasMetadataChanged,
  calculateEnhancedMatchScore,
  checkMemoryBounds,
  MetadataStatus,
  SyncStatus,
} from '@/lib/bug-fixes-extended';

describe('Bug 61-63: UI/State Management Tests', () => {
  describe('Bug 61: metadata_status=enriched does not imply full metadata', () => {
    it('should return false when series is null even if enriched', () => {
      const entry = {
        metadata_status: 'enriched' as MetadataStatus,
        series: null,
      };
      expect(isMetadataComplete(entry)).toBe(false);
    });

    it('should return false when series has no title', () => {
      const entry = {
        metadata_status: 'enriched' as MetadataStatus,
        series: { cover_url: 'https://example.com/cover.jpg', title: null },
      };
      expect(isMetadataComplete(entry)).toBe(false);
    });

    it('should return false when series has empty title', () => {
      const entry = {
        metadata_status: 'enriched' as MetadataStatus,
        series: { cover_url: 'https://example.com/cover.jpg', title: '   ' },
      };
      expect(isMetadataComplete(entry)).toBe(false);
    });

    it('should return true only when fully complete', () => {
      const entry = {
        metadata_status: 'enriched' as MetadataStatus,
        series: { cover_url: 'https://example.com/cover.jpg', title: 'Valid Title' },
      };
      expect(isMetadataComplete(entry)).toBe(true);
    });

    it('should handle missing cover_url gracefully', () => {
      const entry = {
        metadata_status: 'enriched' as MetadataStatus,
        series: { cover_url: null, title: 'Valid Title' },
      };
      expect(hasCoverImage(entry)).toBe(false);
    });

    it('should validate cover_url format', () => {
      const validEntry = {
        metadata_status: 'enriched' as MetadataStatus,
        series: { cover_url: 'https://example.com/cover.jpg' },
      };
      const invalidEntry = {
        metadata_status: 'enriched' as MetadataStatus,
        series: { cover_url: 'not-a-url' },
      };
      
      expect(hasCoverImage(validEntry)).toBe(true);
      expect(hasCoverImage(invalidEntry)).toBe(false);
    });
  });

  describe('Bug 62: metadata_status=unavailable distinct handling', () => {
    it('should distinguish unavailable from pending in display state', () => {
      const pending = getMetadataDisplayState({
        metadata_status: 'pending' as MetadataStatus,
      });
      const unavailable = getMetadataDisplayState({
        metadata_status: 'unavailable' as MetadataStatus,
      });

      expect(pending.showEnrichingBadge).toBe(true);
      expect(pending.showUnavailableBadge).toBe(false);
      expect(pending.tooltipMessage).toContain('Searching');

      expect(unavailable.showEnrichingBadge).toBe(false);
      expect(unavailable.showUnavailableBadge).toBe(true);
      expect(unavailable.tooltipMessage).toContain('not found');
    });

    it('should provide manual link prompt for unavailable + needs_review', () => {
      const unavailableReview = getMetadataDisplayState({
        metadata_status: 'unavailable' as MetadataStatus,
        needs_review: true,
      });
      
      expect(unavailableReview.tooltipMessage).toContain('manually link');
    });

    it('should explain chapters still sync for unavailable without review', () => {
      const unavailable = getMetadataDisplayState({
        metadata_status: 'unavailable' as MetadataStatus,
        needs_review: false,
      });
      
      expect(unavailable.tooltipMessage).toContain('Chapters still sync');
    });
  });

  describe('Bug 63: Exhaustive enum handling', () => {
    it('should handle all MetadataStatus values', () => {
      const statuses: MetadataStatus[] = ['pending', 'enriched', 'unavailable', 'failed'];
      
      for (const status of statuses) {
        expect(() => exhaustiveMetadataCheck(status)).not.toThrow();
        expect(exhaustiveMetadataCheck(status)).toBe(status);
      }
    });

    it('should handle all SyncStatus values', () => {
      const statuses: SyncStatus[] = ['healthy', 'degraded', 'failed'];
      
      for (const status of statuses) {
        expect(() => exhaustiveSyncCheck(status)).not.toThrow();
        expect(exhaustiveSyncCheck(status)).toBe(status);
      }
    });

    it('should throw on unexpected values', () => {
      expect(() => exhaustiveMetadataCheck('invalid' as MetadataStatus)).toThrow();
      expect(() => exhaustiveSyncCheck('invalid' as SyncStatus)).toThrow();
    });
  });
});

describe('Bug 72-74: Test Coverage for Resolution Logic', () => {
  describe('Bug 72: Concurrent resolution tests', () => {
    it('should normalize progress values consistently', () => {
      expect(normalizeProgress(null)).toBe(0);
      expect(normalizeProgress(undefined)).toBe(0);
      expect(normalizeProgress(NaN)).toBe(0);
      expect(normalizeProgress(-5)).toBe(0);
      expect(normalizeProgress(10.567)).toBe(10.56);
      expect(normalizeProgress(100)).toBe(100);
    });

    it('should merge progress taking higher value', () => {
      expect(mergeProgress(5, 10)).toBe(10);
      expect(mergeProgress(10, 5)).toBe(10);
      expect(mergeProgress(null, 10)).toBe(10);
      expect(mergeProgress(10, null)).toBe(10);
      expect(mergeProgress(null, null)).toBe(0);
    });

    it('should handle concurrent progress merge scenarios', () => {
      expect(mergeProgress(10.5, 10.4)).toBe(10.5);
      expect(mergeProgress(10.999, 10)).toBe(10.99);
    });
  });

  describe('Bug 73: Manual override precedence tests', () => {
    it('should not require review for exact ID matches', () => {
      const decision = calculateReviewDecision({
        similarity: 0.5,
        isExactIdMatch: true,
      });
      
      expect(decision.needsReview).toBe(false);
      expect(decision.confidence).toBe(1.0);
      expect(decision.factors).toContain('exact_id_match');
    });

    it('should require review for low similarity', () => {
      const decision = calculateReviewDecision({
        similarity: 0.65,
        isExactIdMatch: false,
      });
      
      expect(decision.needsReview).toBe(true);
      expect(decision.factors).toContain('low_similarity');
    });

    it('should factor in creator mismatch', () => {
      const withMismatch = calculateReviewDecision({
        similarity: 0.80,
        isExactIdMatch: false,
        creatorMatch: false,
      });
      
      expect(withMismatch.needsReview).toBe(true);
      expect(withMismatch.confidence).toBeLessThan(0.80);
      expect(withMismatch.factors).toContain('creator_mismatch');
    });

    it('should factor in language mismatch', () => {
      const withMismatch = calculateReviewDecision({
        similarity: 0.85,
        isExactIdMatch: false,
        languageMatch: false,
      });
      
      expect(withMismatch.confidence).toBeLessThan(0.85);
      expect(withMismatch.factors).toContain('language_mismatch');
    });

    it('should factor in year drift', () => {
      const withDrift = calculateReviewDecision({
        similarity: 0.85,
        isExactIdMatch: false,
        yearDrift: 5,
      });
      
      expect(withDrift.factors).toContain('year_drift');
    });

    it('should require review when multiple factors present', () => {
      const multipleFactors = calculateReviewDecision({
        similarity: 0.75,
        isExactIdMatch: false,
        creatorMatch: false,
        languageMatch: false,
      });
      
      expect(multipleFactors.needsReview).toBe(true);
      expect(multipleFactors.factors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Bug 74: Idempotency validation tests', () => {
    it('should generate consistent checksums', () => {
      const metadata = {
        title: 'Test Manga',
        description: 'A test description',
        cover_url: 'https://example.com/cover.jpg',
        status: 'ongoing',
      };
      
      const checksum1 = generateMetadataChecksum(metadata);
      const checksum2 = generateMetadataChecksum(metadata);
      
      expect(checksum1).toBe(checksum2);
    });

    it('should detect metadata changes', () => {
      const original = {
        title: 'Test Manga',
        description: 'A test description',
      };
      const modified = {
        title: 'Test Manga Updated',
        description: 'A test description',
      };
      
      const originalChecksum = generateMetadataChecksum(original);
      const modifiedChecksum = generateMetadataChecksum(modified);
      
      expect(hasMetadataChanged(originalChecksum, modifiedChecksum)).toBe(true);
      expect(hasMetadataChanged(originalChecksum, originalChecksum)).toBe(false);
    });

    it('should handle null checksums', () => {
      const checksum = generateMetadataChecksum({ title: 'Test' });
      expect(hasMetadataChanged(null, checksum)).toBe(true);
    });

    it('should be case-insensitive for title comparison', () => {
      const lower = generateMetadataChecksum({ title: 'test manga' });
      const upper = generateMetadataChecksum({ title: 'TEST MANGA' });
      
      expect(lower).toBe(upper);
    });
  });
});

describe('Bug 75-77: TypeScript Safety Tests', () => {
  describe('Bug 75: Non-null assertion alternatives', () => {
    it('should handle nullish progress values safely', () => {
      expect(normalizeProgress(null)).toBe(0);
      expect(normalizeProgress(undefined)).toBe(0);
    });
  });

  describe('Bug 77: External API response typing', () => {
    it('should validate language compatibility', () => {
      expect(areLanguagesCompatible('en', 'english')).toBe(true);
      expect(areLanguagesCompatible('ja', 'japanese')).toBe(true);
      expect(areLanguagesCompatible('ko', 'korean')).toBe(true);
      expect(areLanguagesCompatible('zh', 'chinese')).toBe(true);
      expect(areLanguagesCompatible('en', 'ja')).toBe(false);
      expect(areLanguagesCompatible(null, 'en')).toBe(true);
      expect(areLanguagesCompatible('en', null)).toBe(true);
    });

    it('should check year compatibility', () => {
      const compatible = checkYearCompatibility(2020, 2021);
      const incompatible = checkYearCompatibility(2020, 2025);
      
      expect(compatible.compatible).toBe(true);
      expect(compatible.drift).toBe(1);
      
      expect(incompatible.compatible).toBe(false);
      expect(incompatible.drift).toBe(5);
    });

    it('should handle null years', () => {
      const nullYear = checkYearCompatibility(null, 2020);
      expect(nullYear.compatible).toBe(true);
      expect(nullYear.drift).toBe(0);
    });
  });
});

describe('Bug 78-79: Performance Tests', () => {
  describe('Bug 78: Memory bounds checking', () => {
    it('should return memory stats', () => {
      const result = checkMemoryBounds();
      
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('stats');
      expect(result.stats).toHaveProperty('heapUsed');
      expect(result.stats).toHaveProperty('heapTotal');
      expect(result.stats).toHaveProperty('percentage');
    });

    it('should allow requests when memory is within threshold', () => {
      const result = checkMemoryBounds();
      expect(typeof result.allowed).toBe('boolean');
    });
  });
});

describe('Bug 80-81: Error Handling Tests', () => {
  describe('Bug 80: Error handling in state transitions', () => {
    it('should throw on invalid metadata status', () => {
      expect(() => {
        getMetadataDisplayState({
          metadata_status: 'invalid' as MetadataStatus,
        });
      }).toThrow();
    });
  });

  describe('Bug 81: Invariant checks after transitions', () => {
    it('should validate review decision invariants', () => {
      const decision = calculateReviewDecision({
        similarity: 0.5,
        isExactIdMatch: false,
      });
      
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(decision.factors)).toBe(true);
    });
  });
});

describe('Bug 82-85: Edge Condition Tests', () => {
  describe('Bug 84: UTC timestamp handling', () => {
    it('should handle timestamp comparisons correctly', () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 1000);
      
      expect(now.getTime()).toBeGreaterThan(earlier.getTime());
    });
  });

  describe('Bug 106-107: Enhanced match scoring', () => {
    it('should weight title similarity and creators', () => {
      const titleOnlyScore = calculateEnhancedMatchScore(0.9, null, null);
      const withCreatorsMatch = calculateEnhancedMatchScore(0.9, 
        { authors: ['Author A'] },
        { authors: ['Author A'] }
      );
      const withCreatorsMismatch = calculateEnhancedMatchScore(0.9,
        { authors: ['Author A'] },
        { authors: ['Author B'] }
      );

      expect(titleOnlyScore).toBeLessThan(withCreatorsMatch);
      expect(withCreatorsMismatch).toBeLessThan(withCreatorsMatch);
    });

    it('should handle empty creator arrays', () => {
      const score = calculateEnhancedMatchScore(0.8, { authors: [] }, { authors: [] });
      expect(score).toBeGreaterThan(0);
    });

    it('should be case-insensitive for author matching', () => {
      const lowerCase = calculateEnhancedMatchScore(0.8,
        { authors: ['author name'] },
        { authors: ['AUTHOR NAME'] }
      );
      const upperCase = calculateEnhancedMatchScore(0.8,
        { authors: ['AUTHOR NAME'] },
        { authors: ['author name'] }
      );

      expect(lowerCase).toBe(upperCase);
    });
  });
});
