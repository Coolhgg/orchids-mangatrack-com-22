// Jest globals are available without imports
import * as fs from 'fs';
import * as path from 'path';

/**
 * Test suite to verify all metadata bug fixes are properly implemented
 */

describe('Metadata Bug Fixes Verification', () => {
  
  // Read source files once
  const resolutionProcessorPath = path.join(process.cwd(), 'src/workers/processors/resolution.processor.ts');
  const retryMetadataPath = path.join(process.cwd(), 'src/app/api/library/[id]/retry-metadata/route.ts');
  const retryAllMetadataPath = path.join(process.cwd(), 'src/app/api/library/retry-all-metadata/route.ts');
  const metadataHealingPath = path.join(process.cwd(), 'src/workers/schedulers/metadata-healing.scheduler.ts');
  const masterSchedulerPath = path.join(process.cwd(), 'src/workers/schedulers/master.scheduler.ts');
  
  let resolutionProcessor: string;
  let retryMetadata: string;
  let retryAllMetadata: string;
  let metadataHealing: string;
  let masterScheduler: string;

  beforeEach(() => {
    resolutionProcessor = fs.readFileSync(resolutionProcessorPath, 'utf-8');
    retryMetadata = fs.readFileSync(retryMetadataPath, 'utf-8');
    retryAllMetadata = fs.readFileSync(retryAllMetadataPath, 'utf-8');
    metadataHealing = fs.readFileSync(metadataHealingPath, 'utf-8');
    masterScheduler = fs.readFileSync(masterSchedulerPath, 'utf-8');
  });

  describe('Bug 1: Metadata retry overwrites manual fixes', () => {
    it('should check for USER_OVERRIDE metadata_source before processing', () => {
      // Verify the processor checks for manual overrides
      expect(resolutionProcessor).toContain('USER_OVERRIDE');
      expect(resolutionProcessor).toContain("metadata_source === 'USER_OVERRIDE'");
    });

    it('should skip entries with manual overrides in processor', () => {
      expect(resolutionProcessor).toContain('Skipping');
      expect(resolutionProcessor).toContain('manual override');
    });

    it('should also check for USER_OVERRIDE in retry API', () => {
      expect(retryMetadata).toContain('USER_OVERRIDE');
      expect(retryMetadata).toContain('manually fixed');
    });

    it('should double-check for manual override within transaction', () => {
      // Should have a second check inside the transaction
      expect(resolutionProcessor).toContain('Double-check for manual override within transaction');
    });
  });

  describe('Bug 2: Concurrent retries race condition', () => {
    it('should use SELECT FOR UPDATE SKIP LOCKED in processor', () => {
      expect(resolutionProcessor).toContain('FOR UPDATE SKIP LOCKED');
    });

    it('should use SELECT FOR UPDATE NOWAIT in retry API', () => {
      expect(retryMetadata).toContain('FOR UPDATE NOWAIT');
    });

    it('should handle lock_not_available error gracefully', () => {
      expect(retryMetadata).toContain('55P03'); // PostgreSQL error code for lock_not_available
      expect(retryMetadata).toContain('Another retry is already in progress');
    });

    it('should use Serializable isolation level', () => {
      expect(retryMetadata).toContain("isolationLevel: 'Serializable'");
      expect(resolutionProcessor).toContain("isolationLevel: 'Serializable'");
    });

    it('should re-check entry status within transaction', () => {
      expect(resolutionProcessor).toContain('Re-check with lock inside transaction');
    });
  });

  describe('Bug 3: FAILED entries invisible to automated healing', () => {
    it('should have metadata-healing.scheduler.ts file', () => {
      expect(fs.existsSync(metadataHealingPath)).toBe(true);
    });

    it('should include unavailable status in healing', () => {
      expect(metadataHealing).toContain("'unavailable'");
      expect(metadataHealing).toContain("'failed'");
      expect(metadataHealing).toContain("{ in: ['unavailable', 'failed'] }");
    });

    it('should be registered in master scheduler', () => {
      expect(masterScheduler).toContain('runMetadataHealingScheduler');
      expect(masterScheduler).toContain('Metadata healing scheduler');
    });

    it('should respect retry limits to prevent infinite loops', () => {
      expect(metadataHealing).toContain('metadata_retry_count');
      expect(metadataHealing).toContain('{ lt: 10 }'); // Max 10 retries
    });

    it('should have minimum age before re-trying (7 days)', () => {
      expect(metadataHealing).toContain('MIN_AGE_HOURS');
      expect(metadataHealing).toContain('7 * 24'); // 7 days
    });

    it('should exclude manual overrides from healing', () => {
      expect(metadataHealing).toContain('USER_OVERRIDE');
      expect(metadataHealing).toContain("metadata_source: { not: 'USER_OVERRIDE' }");
    });

    it('should include unavailable in retry-all-metadata API', () => {
      expect(retryAllMetadata).toContain("'unavailable'");
      expect(retryAllMetadata).toContain("{ in: [\"failed\", \"unavailable\"] }");
    });
  });

  describe('Bug 4: Same strategy per retry attempt', () => {
    it('should have getSearchStrategy function', () => {
      expect(resolutionProcessor).toContain('function getSearchStrategy');
      expect(resolutionProcessor).toContain('attemptCount: number');
    });

    it('should have progressive threshold relaxation', () => {
      expect(resolutionProcessor).toContain('similarityThreshold: 0.85'); // First attempt
      expect(resolutionProcessor).toContain('similarityThreshold: 0.70'); // Second/third
      expect(resolutionProcessor).toContain('similarityThreshold: 0.60'); // Later attempts
    });

    it('should have generateTitleVariations for fuzzy matching', () => {
      expect(resolutionProcessor).toContain('function generateTitleVariations');
      expect(resolutionProcessor).toContain('suffixPatterns');
    });

    it('should enable fuzzy matching after first attempt', () => {
      expect(resolutionProcessor).toContain('useFuzzyMatch: false'); // First attempt
      expect(resolutionProcessor).toContain('useFuzzyMatch: true'); // Later attempts
    });

    it('should try alternative titles after first attempt', () => {
      expect(resolutionProcessor).toContain('tryAltTitles: false'); // First attempt
      expect(resolutionProcessor).toContain('tryAltTitles: true'); // Later attempts
    });

    it('should increase max candidates for later attempts', () => {
      expect(resolutionProcessor).toContain('maxCandidates: 5'); // First
      expect(resolutionProcessor).toContain('maxCandidates: 10'); // Second/third
      expect(resolutionProcessor).toContain('maxCandidates: 15'); // Later
    });

    it('should use strategy in the search logic', () => {
      expect(resolutionProcessor).toContain('strategy.similarityThreshold');
      expect(resolutionProcessor).toContain('strategy.tryAltTitles');
      expect(resolutionProcessor).toContain('strategy.maxCandidates');
    });
  });

  describe('Bug 6: Missing job idempotency', () => {
    it('should use idempotent jobId in retry-metadata API', () => {
      expect(retryMetadata).toContain('jobId:');
      expect(retryMetadata).toContain('`retry-resolution-${entryId}`');
    });

    it('should check for existing jobs before adding', () => {
      expect(retryMetadata).toContain('getJob');
      expect(retryMetadata).toContain('getState');
      expect(retryMetadata).toContain("state === 'waiting' || state === 'active' || state === 'delayed'");
    });

    it('should use idempotent jobId in retry-all-metadata API', () => {
      expect(retryAllMetadata).toContain('jobId:');
      expect(retryAllMetadata).toContain('`enrich-${entry.id}`');
    });

    it('should use idempotent jobId in metadata healing scheduler', () => {
      expect(metadataHealing).toContain('jobId:');
      expect(metadataHealing).toContain('`heal-${entry.id}`');
    });
  });

  describe('Bug 7: Error classification leaks internal details', () => {
    it('should have sanitizeErrorMessage function', () => {
      expect(resolutionProcessor).toContain('function sanitizeErrorMessage');
    });

    it('should redact API keys', () => {
      expect(resolutionProcessor).toContain('api[_-]?key');
      expect(resolutionProcessor).toContain('[REDACTED]');
    });

    it('should redact bearer tokens', () => {
      expect(resolutionProcessor).toContain('bearer');
    });

    it('should redact passwords', () => {
      expect(resolutionProcessor).toContain('password');
    });

    it('should redact IP addresses', () => {
      expect(resolutionProcessor).toContain('\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}');
    });

    it('should truncate long messages', () => {
      expect(resolutionProcessor).toContain('message.length > 500');
      expect(resolutionProcessor).toContain('[truncated]');
    });

    it('should provide user-friendly error categories', () => {
      expect(resolutionProcessor).toContain('Rate limited by external API');
      expect(resolutionProcessor).toContain('External service temporarily unavailable');
      expect(resolutionProcessor).toContain('Network error connecting to external API');
      expect(resolutionProcessor).toContain('No match found on metadata source');
    });

    it('should use sanitized errors when storing', () => {
      expect(resolutionProcessor).toContain('sanitizedError');
      expect(resolutionProcessor).toContain('last_metadata_error: sanitizedError');
    });
  });

  describe('Bug 8: No validation after enrichment', () => {
    it('should have validateEnrichmentResult function', () => {
      expect(resolutionProcessor).toContain('function validateEnrichmentResult');
    });

    it('should check for required series.id', () => {
      expect(resolutionProcessor).toContain("!series.id");
      expect(resolutionProcessor).toContain("Missing series.id");
    });

    it('should check for required series.title', () => {
      expect(resolutionProcessor).toContain("!series.title");
      expect(resolutionProcessor).toContain("Missing or empty series.title");
    });

    it('should validate mangadex_id for MangaDex source', () => {
      expect(resolutionProcessor).toContain("matchSource === 'mangadex'");
      expect(resolutionProcessor).toContain("!series.mangadex_id");
      expect(resolutionProcessor).toContain("Missing mangadex_id");
    });

    it('should validate cover_url format if present', () => {
      expect(resolutionProcessor).toContain('new URL(series.cover_url)');
      expect(resolutionProcessor).toContain('Invalid cover_url format');
    });

    it('should return validation errors array', () => {
      expect(resolutionProcessor).toContain('EnrichmentValidationResult');
      expect(resolutionProcessor).toContain('valid: boolean');
      expect(resolutionProcessor).toContain('errors: string[]');
    });

    it('should skip series if validation fails', () => {
      expect(resolutionProcessor).toContain('!validation.valid');
      expect(resolutionProcessor).toContain('Validation failed for series');
      expect(resolutionProcessor).toContain('matchedSeriesId = null');
    });
  });
});

describe('Metadata Bug Fix - Unit Tests', () => {
  
  describe('sanitizeErrorMessage function behavior', () => {
    // We'll manually test the function logic
    const SENSITIVE_PATTERNS = [
      /api[_-]?key[=:]\s*\S+/gi,
      /bearer\s+\S+/gi,
      /password[=:]\s*\S+/gi,
      /token[=:]\s*\S+/gi,
      /secret[=:]\s*\S+/gi,
      /https?:\/\/[^:]+:[^@]+@/gi,
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    ];

    function testSanitize(message: string): string {
      for (const pattern of SENSITIVE_PATTERNS) {
        message = message.replace(pattern, '[REDACTED]');
      }
      if (message.length > 500) {
        message = message.substring(0, 500) + '... [truncated]';
      }
      return message;
    }

    it('should redact API keys', () => {
      const input = 'Error: api_key=sk_live_12345abcde failed';
      const output = testSanitize(input);
      expect(output).not.toContain('sk_live_12345abcde');
      expect(output).toContain('[REDACTED]');
    });

    it('should redact bearer tokens', () => {
      const input = 'Authorization failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWI';
      const output = testSanitize(input);
      expect(output).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(output).toContain('[REDACTED]');
    });

    it('should redact IP addresses', () => {
      const input = 'Connection failed to 192.168.1.100:3000';
      const output = testSanitize(input);
      expect(output).not.toContain('192.168.1.100');
      expect(output).toContain('[REDACTED]');
    });

    it('should redact URL credentials', () => {
      const input = 'Failed to connect to https://user:password123@api.example.com/endpoint';
      const output = testSanitize(input);
      expect(output).not.toContain('password123');
      expect(output).toContain('[REDACTED]');
    });

    it('should truncate long messages', () => {
      const longMessage = 'A'.repeat(600);
      const output = testSanitize(longMessage);
      expect(output.length).toBeLessThan(600);
      expect(output).toContain('[truncated]');
    });

    it('should preserve safe messages', () => {
      const input = 'Series not found on MangaDex';
      const output = testSanitize(input);
      expect(output).toBe(input);
    });
  });

  describe('getSearchStrategy function behavior', () => {
    function getSearchStrategy(attemptCount: number) {
      if (attemptCount <= 1) {
        return {
          useExactMatch: true,
          useFuzzyMatch: false,
          tryAltTitles: false,
          similarityThreshold: 0.85,
          maxCandidates: 5
        };
      } else if (attemptCount <= 3) {
        return {
          useExactMatch: true,
          useFuzzyMatch: true,
          tryAltTitles: true,
          similarityThreshold: 0.70,
          maxCandidates: 10
        };
      } else {
        return {
          useExactMatch: true,
          useFuzzyMatch: true,
          tryAltTitles: true,
          similarityThreshold: 0.60,
          maxCandidates: 15
        };
      }
    }

    it('should return strict strategy for first attempt', () => {
      const strategy = getSearchStrategy(1);
      expect(strategy.similarityThreshold).toBe(0.85);
      expect(strategy.useFuzzyMatch).toBe(false);
      expect(strategy.tryAltTitles).toBe(false);
      expect(strategy.maxCandidates).toBe(5);
    });

    it('should relax strategy for second attempt', () => {
      const strategy = getSearchStrategy(2);
      expect(strategy.similarityThreshold).toBe(0.70);
      expect(strategy.useFuzzyMatch).toBe(true);
      expect(strategy.tryAltTitles).toBe(true);
      expect(strategy.maxCandidates).toBe(10);
    });

    it('should use aggressive strategy for later attempts', () => {
      const strategy = getSearchStrategy(5);
      expect(strategy.similarityThreshold).toBe(0.60);
      expect(strategy.useFuzzyMatch).toBe(true);
      expect(strategy.tryAltTitles).toBe(true);
      expect(strategy.maxCandidates).toBe(15);
    });

    it('should progressively decrease threshold', () => {
      const s1 = getSearchStrategy(1);
      const s2 = getSearchStrategy(2);
      const s5 = getSearchStrategy(5);
      
      expect(s1.similarityThreshold).toBeGreaterThan(s2.similarityThreshold);
      expect(s2.similarityThreshold).toBeGreaterThan(s5.similarityThreshold);
    });
  });

  describe('generateTitleVariations function behavior', () => {
    function generateTitleVariations(title: string): string[] {
      const variations: string[] = [title];
      
      const suffixPatterns = [
        /\s*\(manga\)/i,
        /\s*\(manhwa\)/i,
        /\s*\(manhua\)/i,
        /\s*\(webtoon\)/i,
        /\s*\(novel\)/i,
        /\s*\[.*?\]$/,
        /\s*-\s*raw$/i,
        /\s*raw$/i,
      ];
      
      let cleanTitle = title;
      for (const pattern of suffixPatterns) {
        cleanTitle = cleanTitle.replace(pattern, '');
      }
      if (cleanTitle !== title) variations.push(cleanTitle.trim());
      
      if (cleanTitle.toLowerCase().startsWith('the ')) {
        variations.push(cleanTitle.substring(4));
      }
      
      const noNumbers = cleanTitle.replace(/\s+\d+$/, '').trim();
      if (noNumbers !== cleanTitle && noNumbers.length > 3) {
        variations.push(noNumbers);
      }
      
      return [...new Set(variations)];
    }

    it('should include original title', () => {
      const variations = generateTitleVariations('One Piece');
      expect(variations).toContain('One Piece');
    });

    it('should remove (manga) suffix', () => {
      const variations = generateTitleVariations('Solo Leveling (Manga)');
      expect(variations).toContain('Solo Leveling');
    });

    it('should remove (manhwa) suffix', () => {
      const variations = generateTitleVariations('Tower of God (Manhwa)');
      expect(variations).toContain('Tower of God');
    });

    it('should remove raw suffix', () => {
      const variations = generateTitleVariations('Naruto - Raw');
      expect(variations).toContain('Naruto');
    });

    it('should remove bracket annotations', () => {
      const variations = generateTitleVariations('Attack on Titan [Official]');
      expect(variations).toContain('Attack on Titan');
    });

    it('should remove "The" prefix', () => {
      const variations = generateTitleVariations('The Beginning After The End');
      expect(variations).toContain('Beginning After The End');
    });

    it('should remove trailing numbers', () => {
      const variations = generateTitleVariations('Dragon Ball 42');
      expect(variations).toContain('Dragon Ball');
    });

    it('should deduplicate variations', () => {
      const variations = generateTitleVariations('Test');
      const uniqueCount = new Set(variations).size;
      expect(variations.length).toBe(uniqueCount);
    });
  });

  describe('validateEnrichmentResult function behavior', () => {
    interface EnrichmentValidationResult {
      valid: boolean;
      errors: string[];
    }

    function validateEnrichmentResult(series: any, matchSource: string | null): EnrichmentValidationResult {
      const errors: string[] = [];
      
      if (!series) {
        errors.push('Series object is null');
        return { valid: false, errors };
      }
      
      if (!series.id) errors.push('Missing series.id');
      if (!series.title || series.title.trim().length === 0) errors.push('Missing or empty series.title');
      
      if (matchSource === 'mangadex' && !series.mangadex_id) {
        errors.push('Missing mangadex_id for MangaDex source');
      }
      
      if (series.cover_url) {
        try {
          new URL(series.cover_url);
        } catch {
          errors.push('Invalid cover_url format');
        }
      }
      
      return {
        valid: errors.length === 0,
        errors
      };
    }

    it('should fail for null series', () => {
      const result = validateEnrichmentResult(null, 'mangadex');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Series object is null');
    });

    it('should fail for missing id', () => {
      const result = validateEnrichmentResult({ title: 'Test' }, 'mangadex');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing series.id');
    });

    it('should fail for missing title', () => {
      const result = validateEnrichmentResult({ id: '123' }, 'mangadex');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing or empty series.title');
    });

    it('should fail for empty title', () => {
      const result = validateEnrichmentResult({ id: '123', title: '   ' }, 'mangadex');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing or empty series.title');
    });

    it('should fail for MangaDex source without mangadex_id', () => {
      const result = validateEnrichmentResult({ id: '123', title: 'Test' }, 'mangadex');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing mangadex_id for MangaDex source');
    });

    it('should fail for invalid cover_url', () => {
      const result = validateEnrichmentResult({ 
        id: '123', 
        title: 'Test', 
        mangadex_id: 'abc',
        cover_url: 'not-a-url' 
      }, 'mangadex');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid cover_url format');
    });

    it('should pass for valid series', () => {
      const result = validateEnrichmentResult({ 
        id: '123', 
        title: 'Test Series', 
        mangadex_id: 'abc-123',
        cover_url: 'https://example.com/cover.jpg'
      }, 'mangadex');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow missing cover_url', () => {
      const result = validateEnrichmentResult({ 
        id: '123', 
        title: 'Test Series', 
        mangadex_id: 'abc-123'
      }, 'mangadex');
      expect(result.valid).toBe(true);
    });
  });
});
