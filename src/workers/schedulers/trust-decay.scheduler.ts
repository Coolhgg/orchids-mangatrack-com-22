/**
 * Trust Score Decay Scheduler
 * 
 * Processes daily trust score recovery for all users.
 * 
 * FORMULA: trust_score += 0.02/day, cap at 1.0
 * 
 * This is UNCONDITIONAL forgiveness - prevents permanent punishment.
 * Should run once per day (controlled by master scheduler frequency).
 */

import { prisma } from '@/lib/prisma';
import { processDailyDecay, DECAY_PER_DAY } from '@/lib/gamification/trust-score';

// Track last run to ensure we only run once per day
const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function runTrustScoreDecayScheduler(): Promise<void> {
  console.log('[Trust-Decay-Scheduler] Checking if daily decay should run...');

  try {
    // Check if we've already run today by looking at a scheduler state record
    const lastRun = await prisma.$queryRaw<{ last_run: Date }[]>`
      SELECT value::timestamptz as last_run 
      FROM scheduler_state 
      WHERE key = 'trust_score_decay_last_run'
      LIMIT 1
    `.catch(() => []);

    const now = new Date();
    const lastRunDate = lastRun[0]?.last_run;
    
    // Skip if we've run within the last 23 hours (buffer for scheduler timing)
    if (lastRunDate) {
      const hoursSinceLastRun = (now.getTime() - new Date(lastRunDate).getTime()) / (60 * 60 * 1000);
      if (hoursSinceLastRun < 23) {
        console.log(`[Trust-Decay-Scheduler] Skipping - last run was ${hoursSinceLastRun.toFixed(1)} hours ago`);
        return;
      }
    }

    // Run the decay process
    const result = await processDailyDecay();
    
    // Update last run timestamp
    await prisma.$executeRaw`
      INSERT INTO scheduler_state (key, value, updated_at)
      VALUES ('trust_score_decay_last_run', ${now.toISOString()}::text, ${now})
      ON CONFLICT (key) DO UPDATE SET value = ${now.toISOString()}::text, updated_at = ${now}
    `.catch(() => {
      // Table might not exist, that's okay - the decay still ran
      console.log('[Trust-Decay-Scheduler] Note: scheduler_state table not found, decay ran without persistence');
    });

    console.log(`[Trust-Decay-Scheduler] Daily decay complete:`, {
      usersRecovered: result.recoveredCount,
      fullyRecovered: result.fullyRecoveredCount,
      decayRate: `+${DECAY_PER_DAY}/day`
    });

  } catch (error) {
    console.error('[Trust-Decay-Scheduler] Failed to process daily decay:', error);
    throw error;
  }
}
