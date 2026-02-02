/**
 * QA: ANIME SEASON XP SYSTEM
 * 
 * Comprehensive test cases for the anime-style quarterly season system.
 * Run with: npx ts-node scripts/qa/qa-anime-season-xp.ts
 */

import {
  getCurrentSeason,
  getCurrentSeasonInfo,
  getSeasonFromMonth,
  parseSeason,
  getSeasonDisplayName,
  getSeasonDateRange,
  needsSeasonRollover,
  calculateSeasonXpUpdate,
  convertLegacySeasonCode,
  getPreviousSeason,
  getNextSeason,
  getRecentSeasons,
  getSeasonDaysRemaining,
  getSeasonProgress,
  ANIME_SEASONS,
  getSeasonContext
} from '../../src/lib/gamification/seasons';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => boolean | string): void {
  try {
    const result = fn();
    if (result === true) {
      results.push({ name, passed: true, details: '✓' });
    } else {
      results.push({ name, passed: false, details: typeof result === 'string' ? result : 'Failed' });
    }
  } catch (error: any) {
    results.push({ name, passed: false, details: `Error: ${error.message}` });
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): boolean | string {
  if (actual === expected) return true;
  return `${label}: Expected ${expected}, got ${actual}`;
}

function assertMatch(actual: string, pattern: RegExp, label: string): boolean | string {
  if (pattern.test(actual)) return true;
  return `${label}: "${actual}" does not match ${pattern}`;
}

console.log('\n🎌 QA: ANIME SEASON XP SYSTEM\n');
console.log('='.repeat(60));

// ============================================================================
// 1. SEASON DETECTION
// ============================================================================
console.log('\n📅 1. SEASON DETECTION\n');

test('Feb 10 → Winter', () => {
  const season = getSeasonFromMonth(2);
  return assertEqual(season.key, 'winter', 'February season');
});

test('Apr 1 → Spring', () => {
  const season = getSeasonFromMonth(4);
  return assertEqual(season.key, 'spring', 'April season');
});

test('Dec 31 → Fall', () => {
  const season = getSeasonFromMonth(12);
  return assertEqual(season.key, 'fall', 'December season');
});

test('All month mappings correct', () => {
  const expected: Record<number, string> = {
    1: 'winter', 2: 'winter', 3: 'winter',
    4: 'spring', 5: 'spring', 6: 'spring',
    7: 'summer', 8: 'summer', 9: 'summer',
    10: 'fall', 11: 'fall', 12: 'fall'
  };
  
  for (let month = 1; month <= 12; month++) {
    const season = getSeasonFromMonth(month);
    if (season.key !== expected[month]) {
      return `Month ${month}: Expected ${expected[month]}, got ${season.key}`;
    }
  }
  return true;
});

test('getCurrentSeason returns YYYY-Q[1-4] format', () => {
  const season = getCurrentSeason();
  return assertMatch(season, /^\d{4}-Q[1-4]$/, 'Season format');
});

test('getCurrentSeasonInfo contains all fields', () => {
  const info = getCurrentSeasonInfo();
  if (!info.code) return 'Missing code';
  if (!info.key) return 'Missing key';
  if (!info.name) return 'Missing name';
  if (!info.year) return 'Missing year';
  if (!info.quarter) return 'Missing quarter';
  if (!info.displayName) return 'Missing displayName';
  return true;
});

// ============================================================================
// 2. XP ACCRUAL
// ============================================================================
console.log('\n💎 2. XP ACCRUAL\n');

test('Same season: XP adds to existing season_xp', () => {
  const currentSeason = getCurrentSeason();
  const result = calculateSeasonXpUpdate(100, currentSeason, 10);
  return assertEqual(result.season_xp, 110, 'Season XP addition');
});

test('Same season: current_season unchanged', () => {
  const currentSeason = getCurrentSeason();
  const result = calculateSeasonXpUpdate(100, currentSeason, 10);
  return assertEqual(result.current_season, currentSeason, 'Current season unchanged');
});

test('Different season: XP starts fresh (rollover)', () => {
  const oldSeason = '2020-Q1';
  const result = calculateSeasonXpUpdate(1000, oldSeason, 10);
  return assertEqual(result.season_xp, 10, 'Season XP reset on rollover');
});

test('Different season: current_season updated', () => {
  const oldSeason = '2020-Q1';
  const currentSeason = getCurrentSeason();
  const result = calculateSeasonXpUpdate(1000, oldSeason, 10);
  return assertEqual(result.current_season, currentSeason, 'Season updated on rollover');
});

test('Null season_xp treated as 0', () => {
  const currentSeason = getCurrentSeason();
  const result = calculateSeasonXpUpdate(null, currentSeason, 10);
  return assertEqual(result.season_xp, 10, 'Null XP treated as 0');
});

// ============================================================================
// 3. SEASON RESET
// ============================================================================
console.log('\n🔄 3. SEASON RESET\n');

test('needsSeasonRollover: null → true', () => {
  return assertEqual(needsSeasonRollover(null), true, 'Null needs rollover');
});

test('needsSeasonRollover: current season → false', () => {
  const currentSeason = getCurrentSeason();
  return assertEqual(needsSeasonRollover(currentSeason), false, 'Current season no rollover');
});

test('needsSeasonRollover: old season → true', () => {
  return assertEqual(needsSeasonRollover('2020-Q1'), true, 'Old season needs rollover');
});

test('Season rollover preserves only new XP', () => {
  const oldSeason = '2020-Q1';
  const oldSeasonXp = 5000;
  const newXp = 10;
  
  const result = calculateSeasonXpUpdate(oldSeasonXp, oldSeason, newXp);
  
  if (result.season_xp !== newXp) {
    return `Expected ${newXp}, got ${result.season_xp} (old XP should be discarded)`;
  }
  return true;
});

// ============================================================================
// 4. LEADERBOARD
// ============================================================================
console.log('\n🏆 4. LEADERBOARD CONTEXT\n');

test('getSeasonContext returns all required fields', () => {
  const ctx = getSeasonContext();
  const requiredFields = [
    'current_season', 'season_key', 'season_name', 'season_year',
    'season_display', 'days_remaining', 'progress', 'starts_at', 'ends_at'
  ];
  
  for (const field of requiredFields) {
    if (!(field in ctx)) {
      return `Missing field: ${field}`;
    }
  }
  return true;
});

test('getRecentSeasons returns correct count', () => {
  const seasons = getRecentSeasons(4);
  return assertEqual(seasons.length, 4, 'Recent seasons count');
});

test('getRecentSeasons starts with current season', () => {
  const seasons = getRecentSeasons(4);
  const currentSeason = getCurrentSeason();
  return assertEqual(seasons[0], currentSeason, 'First season is current');
});

test('getRecentSeasons are in descending order', () => {
  const seasons = getRecentSeasons(4);
  for (let i = 1; i < seasons.length; i++) {
    if (seasons[i] >= seasons[i - 1]) {
      return `Seasons not in descending order at index ${i}`;
    }
  }
  return true;
});

// ============================================================================
// 5. ACHIEVEMENTS (Seasonal vs Lifetime)
// ============================================================================
console.log('\n🏅 5. ACHIEVEMENTS CONTEXT\n');

test('Season date range covers full quarter', () => {
  const range = getSeasonDateRange('2026-Q1');
  if (!range) return 'Failed to get date range';
  
  const startMonth = range.start.getUTCMonth();
  const endMonth = range.end.getUTCMonth();
  
  if (startMonth !== 0) return `Winter should start in January, got month ${startMonth}`;
  if (endMonth !== 2) return `Winter should end in March, got month ${endMonth}`;
  return true;
});

test('All quarters have correct date ranges', () => {
  const quarters = [
    { code: '2026-Q1', startMonth: 0, endMonth: 2, name: 'Winter' },
    { code: '2026-Q2', startMonth: 3, endMonth: 5, name: 'Spring' },
    { code: '2026-Q3', startMonth: 6, endMonth: 8, name: 'Summer' },
    { code: '2026-Q4', startMonth: 9, endMonth: 11, name: 'Fall' },
  ];
  
  for (const q of quarters) {
    const range = getSeasonDateRange(q.code);
    if (!range) return `No range for ${q.code}`;
    
    if (range.start.getUTCMonth() !== q.startMonth) {
      return `${q.name} start month: expected ${q.startMonth}, got ${range.start.getUTCMonth()}`;
    }
    if (range.end.getUTCMonth() !== q.endMonth) {
      return `${q.name} end month: expected ${q.endMonth}, got ${range.end.getUTCMonth()}`;
    }
  }
  return true;
});

// ============================================================================
// 6. DATA SAFETY
// ============================================================================
console.log('\n🔒 6. DATA SAFETY\n');

test('calculateSeasonXpUpdate never returns negative XP', () => {
  const result = calculateSeasonXpUpdate(-100, getCurrentSeason(), 10);
  if (result.season_xp < 0) {
    return `Negative XP returned: ${result.season_xp}`;
  }
  return true;
});

test('Season format conversion is idempotent', () => {
  const quarterly = '2026-Q1';
  const converted = convertLegacySeasonCode(quarterly);
  return assertEqual(converted, quarterly, 'Quarterly format unchanged');
});

test('Legacy format correctly converted', () => {
  const conversions: [string, string][] = [
    ['2026-01', '2026-Q1'],
    ['2026-03', '2026-Q1'],
    ['2026-04', '2026-Q2'],
    ['2026-06', '2026-Q2'],
    ['2026-07', '2026-Q3'],
    ['2026-09', '2026-Q3'],
    ['2026-10', '2026-Q4'],
    ['2026-12', '2026-Q4'],
  ];
  
  for (const [legacy, expected] of conversions) {
    const result = convertLegacySeasonCode(legacy);
    if (result !== expected) {
      return `${legacy} → expected ${expected}, got ${result}`;
    }
  }
  return true;
});

// ============================================================================
// 7. EDGE CASES
// ============================================================================
console.log('\n⚠️ 7. EDGE CASES\n');

test('New user (null season) gets correct initialization', () => {
  const result = calculateSeasonXpUpdate(null, null, 10);
  return assertEqual(result.season_xp, 10, 'New user XP');
});

test('User inactive entire season starts at 0', () => {
  // Simulates a user who hasn't read anything this season
  const lastActiveSeason = getPreviousSeason(getCurrentSeason());
  const result = calculateSeasonXpUpdate(500, lastActiveSeason, 0);
  return assertEqual(result.season_xp, 0, 'Inactive user XP reset to 0');
});

test('getPreviousSeason wraps year correctly', () => {
  const previous = getPreviousSeason('2026-Q1');
  return assertEqual(previous, '2025-Q4', 'Q1 wraps to previous year Q4');
});

test('getNextSeason wraps year correctly', () => {
  const next = getNextSeason('2026-Q4');
  return assertEqual(next, '2027-Q1', 'Q4 wraps to next year Q1');
});

test('parseSeason handles invalid input gracefully', () => {
  const invalids = ['invalid', '', '2026', '2026-Q5', '2026-13'];
  for (const invalid of invalids) {
    const result = parseSeason(invalid);
    if (result !== null) {
      return `"${invalid}" should return null, got ${JSON.stringify(result)}`;
    }
  }
  return true;
});

test('getSeasonDaysRemaining returns reasonable value', () => {
  const days = getSeasonDaysRemaining();
  if (days < 0) return `Negative days: ${days}`;
  if (days > 92) return `Too many days: ${days}`;
  return true;
});

test('getSeasonProgress returns value 0-1', () => {
  const progress = getSeasonProgress();
  if (progress < 0) return `Negative progress: ${progress}`;
  if (progress > 1) return `Progress > 1: ${progress}`;
  return true;
});

test('Display names are human-readable', () => {
  const names = [
    ['2026-Q1', 'Winter 2026'],
    ['2026-Q2', 'Spring 2026'],
    ['2026-Q3', 'Summer 2026'],
    ['2026-Q4', 'Fall 2026'],
  ];
  
  for (const [code, expected] of names) {
    const result = getSeasonDisplayName(code);
    if (result !== expected) {
      return `${code} → expected "${expected}", got "${result}"`;
    }
  }
  return true;
});

// ============================================================================
// RESULTS SUMMARY
// ============================================================================
console.log('\n' + '='.repeat(60));
console.log('📊 RESULTS SUMMARY\n');

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

for (const result of results) {
  const icon = result.passed ? '✅' : '❌';
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(`${icon} [${status}] ${result.name}`);
  if (!result.passed) {
    console.log(`   └─ ${result.details}`);
  }
}

console.log('\n' + '='.repeat(60));
console.log(`\n📈 Total: ${passed}/${results.length} passed`);

if (failed > 0) {
  console.log(`❌ ${failed} test(s) FAILED\n`);
  process.exit(1);
} else {
  console.log('✅ All tests PASSED\n');
  process.exit(0);
}
