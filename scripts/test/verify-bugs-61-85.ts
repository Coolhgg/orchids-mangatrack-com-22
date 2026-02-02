/**
 * Debug and Verification Script for Bugs 61-85
 * This script tests all the bug fixes by simulating the scenarios
 */

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

import {
  validateEnv,
  resetEnvValidation,
  isProduction,
  isDevelopment,
  isTest,
} from '@/lib/config/env-validation';

import {
  getFeatureFlags,
  isFeatureEnabled,
  resetFeatureFlags,
  setFeatureFlag,
} from '@/lib/config/feature-flags';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`✅ ${name}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error });
    console.log(`❌ ${name}: ${error}`);
  }
}

function expect(value: unknown) {
  return {
    toBe(expected: unknown) {
      if (value !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
      }
    },
    toBeTruthy() {
      if (!value) {
        throw new Error(`Expected truthy value, got ${JSON.stringify(value)}`);
      }
    },
    toBeFalsy() {
      if (value) {
        throw new Error(`Expected falsy value, got ${JSON.stringify(value)}`);
      }
    },
    toContain(expected: string) {
      if (typeof value !== 'string' || !value.includes(expected)) {
        throw new Error(`Expected "${value}" to contain "${expected}"`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof value !== 'number' || value <= expected) {
        throw new Error(`Expected ${value} to be greater than ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (typeof value !== 'number' || value >= expected) {
        throw new Error(`Expected ${value} to be less than ${expected}`);
      }
    },
    toThrow() {
      if (typeof value !== 'function') {
        throw new Error('Expected a function');
      }
      let threw = false;
      try {
        value();
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new Error('Expected function to throw');
      }
    },
    toHaveProperty(prop: string) {
      if (typeof value !== 'object' || value === null || !(prop in value)) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
  };
}

console.log('\n=== BUG 61-63: UI/State Management Tests ===\n');

test('Bug 61: isMetadataComplete returns false when series is null', () => {
  const entry = { metadata_status: 'enriched' as MetadataStatus, series: null };
  expect(isMetadataComplete(entry)).toBe(false);
});

test('Bug 61: isMetadataComplete returns false when title is null', () => {
  const entry = { metadata_status: 'enriched' as MetadataStatus, series: { title: null, cover_url: 'https://example.com/cover.jpg' } };
  expect(isMetadataComplete(entry)).toBe(false);
});

test('Bug 61: isMetadataComplete returns false when title is empty', () => {
  const entry = { metadata_status: 'enriched' as MetadataStatus, series: { title: '   ', cover_url: 'https://example.com/cover.jpg' } };
  expect(isMetadataComplete(entry)).toBe(false);
});

test('Bug 61: isMetadataComplete returns true only when fully complete', () => {
  const entry = { metadata_status: 'enriched' as MetadataStatus, series: { title: 'Valid Title', cover_url: 'https://example.com/cover.jpg' } };
  expect(isMetadataComplete(entry)).toBe(true);
});

test('Bug 61: hasCoverImage validates URL format', () => {
  expect(hasCoverImage({ metadata_status: 'enriched' as MetadataStatus, series: { cover_url: 'https://example.com/cover.jpg' } })).toBe(true);
  expect(hasCoverImage({ metadata_status: 'enriched' as MetadataStatus, series: { cover_url: 'not-a-url' } })).toBe(false);
  expect(hasCoverImage({ metadata_status: 'enriched' as MetadataStatus, series: { cover_url: null } })).toBe(false);
});

test('Bug 62: getMetadataDisplayState distinguishes pending from unavailable', () => {
  const pending = getMetadataDisplayState({ metadata_status: 'pending' as MetadataStatus });
  const unavailable = getMetadataDisplayState({ metadata_status: 'unavailable' as MetadataStatus });
  
  expect(pending.showEnrichingBadge).toBe(true);
  expect(pending.showUnavailableBadge).toBe(false);
  expect(unavailable.showEnrichingBadge).toBe(false);
  expect(unavailable.showUnavailableBadge).toBe(true);
});

test('Bug 62: unavailable with needs_review shows manual link prompt', () => {
  const unavailable = getMetadataDisplayState({ metadata_status: 'unavailable' as MetadataStatus, needs_review: true });
  expect(unavailable.tooltipMessage).toContain('manually link');
});

test('Bug 63: exhaustiveMetadataCheck handles all statuses', () => {
  const statuses: MetadataStatus[] = ['pending', 'enriched', 'unavailable', 'failed'];
  for (const status of statuses) {
    expect(exhaustiveMetadataCheck(status)).toBe(status);
  }
});

test('Bug 63: exhaustiveMetadataCheck throws on invalid status', () => {
  expect(() => exhaustiveMetadataCheck('invalid' as MetadataStatus)).toThrow();
});

console.log('\n=== BUG 70-71: Config/Env Tests ===\n');

test('Bug 70: validateEnv returns validation result', () => {
  resetEnvValidation();
  const result = validateEnv();
  expect(result).toHaveProperty('valid');
  expect(result).toHaveProperty('errors');
  expect(result).toHaveProperty('warnings');
});

test('Bug 71: getFeatureFlags returns default flags', () => {
  resetFeatureFlags();
  delete process.env.FEATURE_FLAGS;
  const flags = getFeatureFlags();
  expect(flags.metadata_retry).toBe(true);
  expect(flags.memory_guards).toBe(true);
});

test('Bug 71: isFeatureEnabled checks individual flags', () => {
  resetFeatureFlags();
  expect(isFeatureEnabled('metadata_retry')).toBe(true);
});

test('Bug 71: setFeatureFlag updates individual flags', () => {
  resetFeatureFlags();
  setFeatureFlag('response_validation', true);
  expect(isFeatureEnabled('response_validation')).toBe(true);
  setFeatureFlag('response_validation', false);
  expect(isFeatureEnabled('response_validation')).toBe(false);
});

console.log('\n=== BUG 72-74: Test Coverage Tests ===\n');

test('Bug 72: normalizeProgress handles edge cases', () => {
  expect(normalizeProgress(null)).toBe(0);
  expect(normalizeProgress(undefined)).toBe(0);
  expect(normalizeProgress(NaN)).toBe(0);
  expect(normalizeProgress(-5)).toBe(0);
  expect(normalizeProgress(10.567)).toBe(10.56);
});

test('Bug 72: mergeProgress takes higher value', () => {
  expect(mergeProgress(5, 10)).toBe(10);
  expect(mergeProgress(10, 5)).toBe(10);
  expect(mergeProgress(null, 10)).toBe(10);
  expect(mergeProgress(null, null)).toBe(0);
});

test('Bug 73: calculateReviewDecision - exact ID match bypasses review', () => {
  const decision = calculateReviewDecision({ similarity: 0.5, isExactIdMatch: true });
  expect(decision.needsReview).toBe(false);
  expect(decision.confidence).toBe(1.0);
});

test('Bug 73: calculateReviewDecision - low similarity requires review', () => {
  const decision = calculateReviewDecision({ similarity: 0.65, isExactIdMatch: false });
  expect(decision.needsReview).toBe(true);
});

test('Bug 73: calculateReviewDecision - creator mismatch reduces confidence', () => {
  const decision = calculateReviewDecision({ similarity: 0.80, isExactIdMatch: false, creatorMatch: false });
  expect(decision.confidence).toBeLessThan(0.80);
});

test('Bug 74: generateMetadataChecksum is consistent', () => {
  const metadata = { title: 'Test Manga', description: 'A test' };
  const checksum1 = generateMetadataChecksum(metadata);
  const checksum2 = generateMetadataChecksum(metadata);
  expect(checksum1).toBe(checksum2);
});

test('Bug 74: hasMetadataChanged detects changes', () => {
  const original = generateMetadataChecksum({ title: 'Test' });
  const modified = generateMetadataChecksum({ title: 'Test Updated' });
  expect(hasMetadataChanged(original, modified)).toBe(true);
  expect(hasMetadataChanged(original, original)).toBe(false);
});

console.log('\n=== BUG 75-77: TypeScript Safety Tests ===\n');

test('Bug 77: areLanguagesCompatible validates language aliases', () => {
  expect(areLanguagesCompatible('en', 'english')).toBe(true);
  expect(areLanguagesCompatible('ja', 'japanese')).toBe(true);
  expect(areLanguagesCompatible('en', 'ja')).toBe(false);
  expect(areLanguagesCompatible(null, 'en')).toBe(true);
});

test('Bug 77: checkYearCompatibility checks drift', () => {
  const compatible = checkYearCompatibility(2020, 2021);
  const incompatible = checkYearCompatibility(2020, 2025);
  
  expect(compatible.compatible).toBe(true);
  expect(compatible.drift).toBe(1);
  expect(incompatible.compatible).toBe(false);
  expect(incompatible.drift).toBe(5);
});

console.log('\n=== BUG 78-79: Performance Tests ===\n');

test('Bug 78: checkMemoryBounds returns stats', () => {
  const result = checkMemoryBounds();
  expect(result).toHaveProperty('allowed');
  expect(result).toHaveProperty('stats');
  expect(result.stats).toHaveProperty('heapUsed');
  expect(result.stats).toHaveProperty('heapTotal');
});

console.log('\n=== BUG 80-81: Error Handling Tests ===\n');

test('Bug 80: getMetadataDisplayState throws on invalid status', () => {
  expect(() => getMetadataDisplayState({ metadata_status: 'invalid' as MetadataStatus })).toThrow();
});

test('Bug 81: calculateReviewDecision validates invariants', () => {
  const decision = calculateReviewDecision({ similarity: 0.5, isExactIdMatch: false });
  expect(decision.confidence >= 0 && decision.confidence <= 1).toBeTruthy();
});

console.log('\n=== BUG 82-85: Edge Condition Tests ===\n');

test('Bug 106-107: calculateEnhancedMatchScore weights creators', () => {
  const titleOnly = calculateEnhancedMatchScore(0.9, null, null);
  const withMatch = calculateEnhancedMatchScore(0.9, { authors: ['Author A'] }, { authors: ['Author A'] });
  const withMismatch = calculateEnhancedMatchScore(0.9, { authors: ['Author A'] }, { authors: ['Author B'] });
  
  expect(withMatch).toBeGreaterThan(titleOnly);
  expect(withMatch).toBeGreaterThan(withMismatch);
});

// Summary
console.log('\n=== TEST SUMMARY ===\n');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`Total: ${results.length} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}

console.log('\n✅ All tests passed!\n');
