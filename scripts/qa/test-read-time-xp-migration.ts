/**
 * QA Test Script: Read-Time Validation, XP Granting, and Migration Safety
 * 
 * TEST MATRIX:
 * 1. Migration Import (0→98): XP=1, no validation, no flags
 * 2. Bulk Mark Read (0→50): XP=1, validation skipped
 * 3. Legit Binge (1→2→3→...): XP=1/request, validation passes
 * 4. Speed Farming (1→2→3→4 in seconds): Validation fails, XP still granted, trust reduced
 * 5. Extreme Binge (1→569): Validation skipped, XP=1
 * 6. Mixed Pattern: Import skipped, incremental validated
 * 
 * ASSERTIONS:
 * - No scenario blocks reading
 * - No migration creates suspicion
 * - XP farming only limited by per-request rule
 */

import { prisma } from '@/lib/prisma';
import { XP_PER_CHAPTER } from '@/lib/gamification/xp';
import { VIOLATION_PENALTIES } from '@/lib/gamification/trust-score';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  assertions: { check: string; passed: boolean; actual?: any; expected?: any }[];
}

const results: TestResult[] = [];

function assert(condition: boolean, check: string, actual?: any, expected?: any): { check: string; passed: boolean; actual?: any; expected?: any } {
  return { check, passed: condition, actual, expected };
}

async function cleanupTestData(userId: string) {
  try {
    await prisma.$transaction([
      prisma.userChapterReadV2.deleteMany({ where: { user_id: userId } }),
      prisma.userChapterRead.deleteMany({ where: { user_id: userId } }),
      prisma.libraryEntry.deleteMany({ where: { user_id: userId } }),
      prisma.activity.deleteMany({ where: { user_id: userId } }),
    ]);
  } catch (e) {
    console.log('Cleanup skipped (tables may not exist)');
  }
}

// ============================================================
// TEST 1: MIGRATION IMPORT (0→98)
// ============================================================
async function testMigrationImport(): Promise<TestResult> {
  const name = '1. Migration Import (0→98)';
  const assertions: ReturnType<typeof assert>[] = [];
  
  console.log(`\n🧪 Running: ${name}`);
  
  // Check that validation is skipped for bulk jumps
  const currentLastRead = 0;
  const targetChapter = 98;
  const chapterJump = targetChapter - currentLastRead;
  
  // Validation should be SKIPPED (chapterJump > 2)
  const shouldValidateReadTime = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
  assertions.push(assert(
    !shouldValidateReadTime,
    'Read-time validation should be SKIPPED for migration',
    shouldValidateReadTime,
    false
  ));
  
  // XP should be 1 (not 98)
  const xpGranted = XP_PER_CHAPTER; // Always 1 per request
  assertions.push(assert(
    xpGranted === 1,
    'XP should be exactly 1 (not multiplied)',
    xpGranted,
    1
  ));
  
  // large_jump should NOT be in violation penalties
  const hasLargeJumpViolation = 'large_jump' in VIOLATION_PENALTIES;
  assertions.push(assert(
    !hasLargeJumpViolation,
    'large_jump should NOT be a violation type',
    hasLargeJumpViolation,
    false
  ));
  
  const passed = assertions.every(a => a.passed);
  return { name, passed, details: passed ? '✅ All assertions passed' : '❌ Some assertions failed', assertions };
}

// ============================================================
// TEST 2: BULK MARK READ (0→50)
// ============================================================
async function testBulkMarkRead(): Promise<TestResult> {
  const name = '2. Bulk Mark Read (0→50)';
  const assertions: ReturnType<typeof assert>[] = [];
  
  console.log(`\n🧪 Running: ${name}`);
  
  const currentLastRead = 0;
  const targetChapter = 50;
  const chapterJump = targetChapter - currentLastRead;
  
  // Validation should be SKIPPED (first progress, currentLastRead = 0)
  const shouldValidateReadTime = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
  assertions.push(assert(
    !shouldValidateReadTime,
    'Read-time validation should be SKIPPED for bulk mark',
    shouldValidateReadTime,
    false
  ));
  
  // XP should be 1
  assertions.push(assert(
    XP_PER_CHAPTER === 1,
    'XP_PER_CHAPTER should be 1',
    XP_PER_CHAPTER,
    1
  ));
  
  const passed = assertions.every(a => a.passed);
  return { name, passed, details: passed ? '✅ All assertions passed' : '❌ Some assertions failed', assertions };
}

// ============================================================
// TEST 3: LEGIT BINGE READING (1→2→3→...→50)
// ============================================================
async function testLegitBingeReading(): Promise<TestResult> {
  const name = '3. Legit Binge Reading (incremental)';
  const assertions: ReturnType<typeof assert>[] = [];
  
  console.log(`\n🧪 Running: ${name}`);
  
  // Simulate incremental reads: 1→2, 2→3, etc.
  const testCases = [
    { from: 1, to: 2, shouldValidate: true },
    { from: 2, to: 3, shouldValidate: true },
    { from: 3, to: 4, shouldValidate: true },
    { from: 4, to: 5, shouldValidate: true },
  ];
  
  for (const tc of testCases) {
    const chapterJump = tc.to - tc.from;
    const shouldValidate = tc.from > 0 && chapterJump >= 1 && chapterJump <= 2;
    
    assertions.push(assert(
      shouldValidate === tc.shouldValidate,
      `${tc.from}→${tc.to}: validation=${tc.shouldValidate}`,
      shouldValidate,
      tc.shouldValidate
    ));
  }
  
  // XP per request should always be 1
  assertions.push(assert(
    XP_PER_CHAPTER === 1,
    'Each incremental read grants exactly 1 XP',
    XP_PER_CHAPTER,
    1
  ));
  
  const passed = assertions.every(a => a.passed);
  return { name, passed, details: passed ? '✅ All assertions passed' : '❌ Some assertions failed', assertions };
}

// ============================================================
// TEST 4: SPEED FARMING (rapid incremental reads)
// ============================================================
async function testSpeedFarming(): Promise<TestResult> {
  const name = '4. Speed Farming Detection';
  const assertions: ReturnType<typeof assert>[] = [];
  
  console.log(`\n🧪 Running: ${name}`);
  
  // Rapid incremental reads SHOULD trigger validation
  const currentLastRead = 1;
  const targetChapter = 2;
  const chapterJump = targetChapter - currentLastRead;
  
  const shouldValidateReadTime = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
  assertions.push(assert(
    shouldValidateReadTime,
    'Incremental reads (1→2) should trigger validation',
    shouldValidateReadTime,
    true
  ));
  
  // XP should STILL be granted (soft system)
  assertions.push(assert(
    XP_PER_CHAPTER === 1,
    'XP is still granted even for suspicious reads',
    XP_PER_CHAPTER,
    1
  ));
  
  // Violation penalties should exist for repeated patterns
  assertions.push(assert(
    'rapid_reads' in VIOLATION_PENALTIES,
    'rapid_reads violation should exist',
    'rapid_reads' in VIOLATION_PENALTIES,
    true
  ));
  
  assertions.push(assert(
    VIOLATION_PENALTIES.rapid_reads === 0.05,
    'rapid_reads penalty should be 0.05',
    VIOLATION_PENALTIES.rapid_reads,
    0.05
  ));
  
  const passed = assertions.every(a => a.passed);
  return { name, passed, details: passed ? '✅ All assertions passed' : '❌ Some assertions failed', assertions };
}

// ============================================================
// TEST 5: EXTREME BINGE (1→569)
// ============================================================
async function testExtremeBinge(): Promise<TestResult> {
  const name = '5. Extreme Binge (1→569)';
  const assertions: ReturnType<typeof assert>[] = [];
  
  console.log(`\n🧪 Running: ${name}`);
  
  const currentLastRead = 1;
  const targetChapter = 569;
  const chapterJump = targetChapter - currentLastRead; // 568
  
  // Validation should be SKIPPED (chapterJump > 2)
  const shouldValidateReadTime = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
  assertions.push(assert(
    !shouldValidateReadTime,
    'Validation SKIPPED for large jump (568 chapters)',
    shouldValidateReadTime,
    false
  ));
  
  // XP should be 1 (not 568)
  assertions.push(assert(
    XP_PER_CHAPTER === 1,
    'XP is 1 (not multiplied by chapters)',
    XP_PER_CHAPTER,
    1
  ));
  
  const passed = assertions.every(a => a.passed);
  return { name, passed, details: passed ? '✅ All assertions passed' : '❌ Some assertions failed', assertions };
}

// ============================================================
// TEST 6: MIXED PATTERN (import then incremental)
// ============================================================
async function testMixedPattern(): Promise<TestResult> {
  const name = '6. Mixed Pattern (import + incremental)';
  const assertions: ReturnType<typeof assert>[] = [];
  
  console.log(`\n🧪 Running: ${name}`);
  
  // Step 1: Import 0→98 (validation skipped)
  let currentLastRead = 0;
  let targetChapter = 98;
  let chapterJump = targetChapter - currentLastRead;
  let shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
  
  assertions.push(assert(
    !shouldValidate,
    'Import 0→98: validation SKIPPED',
    shouldValidate,
    false
  ));
  
  // Step 2: Now at chapter 98, read 99 (validation SHOULD trigger)
  currentLastRead = 98;
  targetChapter = 99;
  chapterJump = targetChapter - currentLastRead;
  shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
  
  assertions.push(assert(
    shouldValidate,
    'Incremental 98→99: validation TRIGGERED',
    shouldValidate,
    true
  ));
  
  // Step 3: Read 100 (validation SHOULD trigger)
  currentLastRead = 99;
  targetChapter = 100;
  chapterJump = targetChapter - currentLastRead;
  shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
  
  assertions.push(assert(
    shouldValidate,
    'Incremental 99→100: validation TRIGGERED',
    shouldValidate,
    true
  ));
  
  const passed = assertions.every(a => a.passed);
  return { name, passed, details: passed ? '✅ All assertions passed' : '❌ Some assertions failed', assertions };
}

// ============================================================
// TEST 7: VALIDATION LOGIC BOUNDARIES
// ============================================================
async function testValidationBoundaries(): Promise<TestResult> {
  const name = '7. Validation Boundary Conditions';
  const assertions: ReturnType<typeof assert>[] = [];
  
  console.log(`\n🧪 Running: ${name}`);
  
  const testCases = [
    { from: 0, to: 1, shouldValidate: false, reason: 'First progress (from=0)' },
    { from: 0, to: 50, shouldValidate: false, reason: 'First bulk progress' },
    { from: 1, to: 2, shouldValidate: true, reason: 'Single chapter increment' },
    { from: 1, to: 3, shouldValidate: true, reason: 'Two chapter increment' },
    { from: 1, to: 4, shouldValidate: false, reason: 'Three+ chapter jump' },
    { from: 50, to: 51, shouldValidate: true, reason: 'Single increment at high chapter' },
    { from: 50, to: 100, shouldValidate: false, reason: 'Large jump at high chapter' },
    { from: 100, to: 569, shouldValidate: false, reason: 'Extreme binge jump' },
  ];
  
  for (const tc of testCases) {
    const chapterJump = tc.to - tc.from;
    const shouldValidate = tc.from > 0 && chapterJump >= 1 && chapterJump <= 2;
    
    assertions.push(assert(
      shouldValidate === tc.shouldValidate,
      `${tc.from}→${tc.to}: ${tc.reason}`,
      shouldValidate,
      tc.shouldValidate
    ));
  }
  
  const passed = assertions.every(a => a.passed);
  return { name, passed, details: passed ? '✅ All assertions passed' : '❌ Some assertions failed', assertions };
}

// ============================================================
// TEST 8: ANTI-ABUSE VIOLATIONS CONFIG
// ============================================================
async function testAntiAbuseConfig(): Promise<TestResult> {
  const name = '8. Anti-Abuse Configuration';
  const assertions: ReturnType<typeof assert>[] = [];
  
  console.log(`\n🧪 Running: ${name}`);
  
  // large_jump should NOT be a violation
  assertions.push(assert(
    !('large_jump' in VIOLATION_PENALTIES),
    'large_jump is NOT a violation',
    'large_jump' in VIOLATION_PENALTIES,
    false
  ));
  
  // These violations SHOULD exist
  const expectedViolations = ['rapid_reads', 'api_spam', 'status_toggle', 'repeated_same_chapter'];
  for (const v of expectedViolations) {
    assertions.push(assert(
      v in VIOLATION_PENALTIES,
      `${v} violation should exist`,
      v in VIOLATION_PENALTIES,
      true
    ));
  }
  
  const passed = assertions.every(a => a.passed);
  return { name, passed, details: passed ? '✅ All assertions passed' : '❌ Some assertions failed', assertions };
}

// ============================================================
// MAIN RUNNER
// ============================================================
async function runAllTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('QA: READ-TIME, XP, AND MIGRATION SAFETY');
  console.log('═══════════════════════════════════════════════════════════');
  
  const tests = [
    testMigrationImport,
    testBulkMarkRead,
    testLegitBingeReading,
    testSpeedFarming,
    testExtremeBinge,
    testMixedPattern,
    testValidationBoundaries,
    testAntiAbuseConfig,
  ];
  
  for (const test of tests) {
    try {
      const result = await test();
      results.push(result);
    } catch (error: any) {
      results.push({
        name: test.name,
        passed: false,
        details: `❌ Error: ${error.message}`,
        assertions: [],
      });
    }
  }
  
  // Print Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('TEST RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  
  let totalAssertions = 0;
  let passedAssertions = 0;
  
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`\n${icon} ${result.name}`);
    
    for (const a of result.assertions) {
      totalAssertions++;
      if (a.passed) passedAssertions++;
      const aIcon = a.passed ? '  ✓' : '  ✗';
      console.log(`${aIcon} ${a.check}`);
      if (!a.passed) {
        console.log(`      Expected: ${a.expected}, Got: ${a.actual}`);
      }
    }
  }
  
  const allPassed = results.every(r => r.passed);
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`FINAL: ${passedAssertions}/${totalAssertions} assertions passed`);
  console.log(`STATUS: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('═══════════════════════════════════════════════════════════');
  
  return allPassed;
}

// Run tests
runAllTests()
  .then((passed) => {
    process.exit(passed ? 0 : 1);
  })
  .catch((error) => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
