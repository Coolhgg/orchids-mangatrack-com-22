// Jest globals are available without imports
import * as fs from 'fs';
import * as path from 'path';

/**
 * INTEGRATION TEST SUITE FOR BUG FIXES
 * 
 * Verifies that bug fix functions are properly integrated into:
 * - resolution.processor.ts
 * - poll-source.processor.ts
 * - api-utils.ts
 */

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), filePath), 'utf-8');
  } catch {
    return '';
  }
}

let resolutionProcessor: string;
let pollSourceProcessor: string;
let apiUtils: string;
let bugFixesExtended: string;

beforeAll(() => {
  resolutionProcessor = readFile('src/workers/processors/resolution.processor.ts');
  pollSourceProcessor = readFile('src/workers/processors/poll-source.processor.ts');
  apiUtils = readFile('src/lib/api-utils.ts');
  bugFixesExtended = readFile('src/lib/bug-fixes-extended.ts');
});

describe('Resolution Processor Integration', () => {
  it('imports bug fix functions', () => {
    expect(resolutionProcessor).toContain("from '@/lib/bug-fixes-extended'");
  });

  it('imports calculateEnhancedMatchScore for Bug 106-107', () => {
    expect(resolutionProcessor).toContain('calculateEnhancedMatchScore');
  });

  it('imports areLanguagesCompatible for Bug 107', () => {
    expect(resolutionProcessor).toContain('areLanguagesCompatible');
  });

  it('imports checkYearCompatibility for Bug 118', () => {
    expect(resolutionProcessor).toContain('checkYearCompatibility');
  });

  it('imports generateMetadataChecksum for Bug 119', () => {
    expect(resolutionProcessor).toContain('generateMetadataChecksum');
  });

  it('imports safeSeriesSourceUpdate for Bug 9', () => {
    expect(resolutionProcessor).toContain('safeSeriesSourceUpdate');
  });

  it('uses safeSeriesSourceUpdate instead of updateMany', () => {
    expect(resolutionProcessor).toContain('safeSeriesSourceUpdate(tx, entryUrl');
  });

  it('imports calculateReviewDecision for Bug 13', () => {
    expect(resolutionProcessor).toContain('calculateReviewDecision');
  });

  it('uses calculateReviewDecision for needs_review', () => {
    expect(resolutionProcessor).toContain('reviewDecision.needsReview');
    expect(resolutionProcessor).toContain('reviewDecision.confidence');
    expect(resolutionProcessor).toContain('reviewDecision.factors');
  });

  it('imports normalizeProgress and mergeProgress for Bug 14', () => {
    expect(resolutionProcessor).toContain('normalizeProgress');
    expect(resolutionProcessor).toContain('mergeProgress');
  });

  it('uses mergeProgress for progress comparison', () => {
    expect(resolutionProcessor).toContain('mergeProgress(');
    expect(resolutionProcessor).toContain('normalizeProgress(');
    expect(resolutionProcessor).toContain('mergedProgressValue');
  });

  it('imports isFeatureEnabled for Bug 192', () => {
    expect(resolutionProcessor).toContain('isFeatureEnabled');
  });
});

describe('Poll Source Processor Integration', () => {
  it('imports bug fix functions', () => {
    expect(pollSourceProcessor).toContain("from '@/lib/bug-fixes-extended'");
  });

  it('imports getMonotonicTimestamp for Bug 161-162', () => {
    expect(pollSourceProcessor).toContain('getMonotonicTimestamp');
  });

  it('imports calculateSafeDelay for Bug 161-162', () => {
    expect(pollSourceProcessor).toContain('calculateSafeDelay');
  });

  it('imports canStartJob for Bug 170-171', () => {
    expect(pollSourceProcessor).toContain('canStartJob');
  });

  it('imports recordJobStart for Bug 170-171', () => {
    expect(pollSourceProcessor).toContain('recordJobStart');
  });

  it('imports recordJobEnd for Bug 170-171', () => {
    expect(pollSourceProcessor).toContain('recordJobEnd');
  });

  it('imports getConcurrencyStats for Bug 170-171', () => {
    expect(pollSourceProcessor).toContain('getConcurrencyStats');
  });

  it('uses concurrency check before processing', () => {
    expect(pollSourceProcessor).toContain('canStartJob(sourceName)');
    expect(pollSourceProcessor).toContain('Concurrency limit reached');
  });

  it('records job start and end', () => {
    expect(pollSourceProcessor).toContain('recordJobStart(sourceName)');
    expect(pollSourceProcessor).toContain('recordJobEnd(sourceName)');
  });

  it('imports getSchedulerConfig for Bug 179', () => {
    expect(pollSourceProcessor).toContain('getSchedulerConfig');
  });

  it('imports isFeatureEnabled for Bug 192', () => {
    expect(pollSourceProcessor).toContain('isFeatureEnabled');
  });
});

describe('API Utils Integration', () => {
  it('imports bug fix functions', () => {
    expect(apiUtils).toContain("from './bug-fixes-extended'");
  });

  it('imports createResponseValidator for Bug 184', () => {
    expect(apiUtils).toContain('createResponseValidator');
  });

  it('imports checkMemoryBounds for Bug 190', () => {
    expect(apiUtils).toContain('checkMemoryBounds');
  });

  it('imports getMemoryStats for Bug 190', () => {
    expect(apiUtils).toContain('getMemoryStats');
  });

  it('imports isFeatureEnabled for Bug 192', () => {
    expect(apiUtils).toContain('isFeatureEnabled');
  });

  it('has checkMemoryGuard function', () => {
    expect(apiUtils).toContain('function checkMemoryGuard()');
    expect(apiUtils).toContain("isFeatureEnabled('memory_guards')");
  });

  it('has validateResponse function', () => {
    expect(apiUtils).toContain('function validateResponse');
    expect(apiUtils).toContain("isFeatureEnabled('response_validation')");
  });

  it('uses checkMemoryGuard in withErrorHandling', () => {
    expect(apiUtils).toContain('checkMemoryGuard()');
    expect(apiUtils).toContain('Bug 190: Check memory bounds');
  });

  it('exports memory and response validation functions', () => {
    expect(apiUtils).toContain('export { createResponseValidator, getMemoryStats, isFeatureEnabled }');
  });
});

describe('Bug Fixes Extended Library', () => {
  it('exports all Bug 106-107 functions', () => {
    expect(bugFixesExtended).toContain('export function normalizeCreatorName');
    expect(bugFixesExtended).toContain('export function calculateCreatorSimilarity');
    expect(bugFixesExtended).toContain('export function normalizeLanguage');
    expect(bugFixesExtended).toContain('export function areLanguagesCompatible');
    expect(bugFixesExtended).toContain('export function calculateEnhancedMatchScore');
  });

  it('exports all Bug 118-119 functions', () => {
    expect(bugFixesExtended).toContain('export function checkYearCompatibility');
    expect(bugFixesExtended).toContain('export function generateMetadataChecksum');
    expect(bugFixesExtended).toContain('export function hasMetadataChanged');
  });

  it('exports all Bug 9 functions', () => {
    expect(bugFixesExtended).toContain('export async function safeSeriesSourceUpdate');
  });

  it('exports all Bug 13 functions', () => {
    expect(bugFixesExtended).toContain('export function calculateReviewDecision');
  });

  it('exports all Bug 14 functions', () => {
    expect(bugFixesExtended).toContain('export function normalizeProgress');
    expect(bugFixesExtended).toContain('export function compareProgress');
    expect(bugFixesExtended).toContain('export function mergeProgress');
  });

  it('exports all Bug 161-162 functions', () => {
    expect(bugFixesExtended).toContain('export function getMonotonicTimestamp');
    expect(bugFixesExtended).toContain('export function calculateSafeDelay');
  });

  it('exports all Bug 170-171 functions', () => {
    expect(bugFixesExtended).toContain('export function canStartJob');
    expect(bugFixesExtended).toContain('export function recordJobStart');
    expect(bugFixesExtended).toContain('export function recordJobEnd');
    expect(bugFixesExtended).toContain('export function getConcurrencyStats');
  });

  it('exports all Bug 179 functions', () => {
    expect(bugFixesExtended).toContain('export function getSchedulerConfig');
    expect(bugFixesExtended).toContain('export function updateSchedulerConfig');
  });

  it('exports all Bug 184 functions', () => {
    expect(bugFixesExtended).toContain('export function createResponseValidator');
  });

  it('exports all Bug 190 functions', () => {
    expect(bugFixesExtended).toContain('export function getMemoryStats');
    expect(bugFixesExtended).toContain('export function checkMemoryBounds');
  });

  it('exports all Bug 192 functions', () => {
    expect(bugFixesExtended).toContain('export function isFeatureEnabled');
    expect(bugFixesExtended).toContain('export function setFeatureFlag');
    expect(bugFixesExtended).toContain('export function getAllFeatureFlags');
  });

  it('exports all Bug 196-197 functions', () => {
    expect(bugFixesExtended).toContain('export function analyzeMigrationRisk');
  });

  it('exports all Bug 112 functions', () => {
    expect(bugFixesExtended).toContain('export function shouldVerifyCover');
    expect(bugFixesExtended).toContain('export function isValidCoverUrl');
    expect(bugFixesExtended).toContain('export function calculateNextVerifyTime');
  });

  it('exports all Bug 121/136 functions', () => {
    expect(bugFixesExtended).toContain('export function verifySourceUrl');
    expect(bugFixesExtended).toContain('export async function validateLibraryEntryReferences');
  });

  it('exports all Bug 128-129 functions', () => {
    expect(bugFixesExtended).toContain('export function handleCompletedSeriesNewChapter');
    expect(bugFixesExtended).toContain('export function shouldSyncLibraryEntry');
  });

  it('exports all Bug 137-138 functions', () => {
    expect(bugFixesExtended).toContain('export function mergeUserMetadata');
    expect(bugFixesExtended).toContain('export function validateUserOverride');
  });

  it('exports all Bug 150 functions', () => {
    expect(bugFixesExtended).toContain('export function buildTrendingSortKey');
    expect(bugFixesExtended).toContain('export function createTrendingCursor');
    expect(bugFixesExtended).toContain('export function parseTrendingCursor');
  });
});

describe('Integration Summary', () => {
  it('all bug fixes are properly integrated', () => {
    const integrations = {
      'resolution.processor.ts': {
        'Bug 9 (safeSeriesSourceUpdate)': resolutionProcessor.includes('safeSeriesSourceUpdate'),
        'Bug 13 (calculateReviewDecision)': resolutionProcessor.includes('calculateReviewDecision'),
        'Bug 14 (normalizeProgress)': resolutionProcessor.includes('normalizeProgress'),
        'Bug 106-107 imports': resolutionProcessor.includes('calculateEnhancedMatchScore'),
        'Bug 118 imports': resolutionProcessor.includes('checkYearCompatibility'),
        'Bug 192 imports': resolutionProcessor.includes('isFeatureEnabled'),
      },
      'poll-source.processor.ts': {
        'Bug 161-162 (monotonic clock)': pollSourceProcessor.includes('getMonotonicTimestamp'),
        'Bug 170-171 (concurrency)': pollSourceProcessor.includes('canStartJob'),
        'Bug 179 (scheduler config)': pollSourceProcessor.includes('getSchedulerConfig'),
        'Bug 192 imports': pollSourceProcessor.includes('isFeatureEnabled'),
      },
      'api-utils.ts': {
        'Bug 184 (response validation)': apiUtils.includes('createResponseValidator'),
        'Bug 190 (memory bounds)': apiUtils.includes('checkMemoryBounds'),
        'Bug 192 (feature flags)': apiUtils.includes('isFeatureEnabled'),
        'checkMemoryGuard function': apiUtils.includes('checkMemoryGuard'),
        'validateResponse function': apiUtils.includes('validateResponse'),
      },
    };

    console.log('\n=== INTEGRATION STATUS ===');
    for (const [file, checks] of Object.entries(integrations)) {
      console.log(`\n${file}:`);
      for (const [check, passed] of Object.entries(checks)) {
        console.log(`  ${passed ? '✅' : '❌'} ${check}`);
      }
    }

    // Verify all integrations pass
    for (const [file, checks] of Object.entries(integrations)) {
      for (const [check, passed] of Object.entries(checks)) {
        expect(passed).toBe(true);
      }
    }
  });
});
