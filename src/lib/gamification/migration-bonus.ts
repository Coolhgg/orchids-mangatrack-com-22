import { prisma, TransactionClient } from "@/lib/prisma"
import { calculateLevel, addXp } from "./xp"

/**
 * MIGRATION XP BONUS SYSTEM
 * 
 * PURPOSE:
 * - Rewards new users for importing existing reading history
 * - Fair onboarding without enabling abuse
 * 
 * RULES (LOCKED):
 * 1. One-time only - cannot be re-earned
 * 2. Non-repeatable - atomic insert prevents race conditions
 * 3. Separate from read XP - uses distinct 'migration_bonus' source
 * 
 * FORMULA:
 * bonus_xp = clamp(total_imported_chapters * 0.25, 50, 500)
 * - Minimum: 50 XP (guaranteed for any valid import)
 * - Maximum: 500 XP (prevents abuse from massive imports)
 * - Rate: 0.25 XP per chapter (less than normal reads)
 */

export const MIGRATION_XP_PER_CHAPTER = 0.25
export const MIGRATION_XP_MIN = 50
export const MIGRATION_XP_CAP = 500
export const MIGRATION_SOURCE = "migration_bonus"

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Calculate migration bonus XP using the formula:
 * bonus_xp = clamp(total_imported_chapters * 0.25, 50, 500)
 */
export function calculateMigrationBonus(importedChapters: number): number {
  if (importedChapters <= 0) return 0
  const rawXp = Math.floor(importedChapters * MIGRATION_XP_PER_CHAPTER)
  return clamp(rawXp, MIGRATION_XP_MIN, MIGRATION_XP_CAP)
}

export interface MigrationBonusResult {
  awarded: boolean
  xpAwarded: number
  chaptersImported: number
  alreadyAwarded: boolean
  newLevel: number
  newXp: number
}

/**
 * Checks if user is eligible for migration bonus (has not received one yet)
 * Note: For atomic operations, use awardMigrationBonusAtomic instead
 */
export async function checkMigrationBonusEligibility(userId: string): Promise<boolean> {
  const existing = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) as count FROM xp_transactions 
     WHERE user_id = $1 AND source = $2`,
    userId,
    MIGRATION_SOURCE
  )
  return Number(existing[0]?.count || 0) === 0
}

/**
 * Awards migration bonus atomically using INSERT ON CONFLICT
 * This prevents race conditions and ensures one-time-only award
 * 
 * RULES ENFORCED:
 * - One-time: Atomic insert with NOT EXISTS check
 * - Non-repeatable: Only ONE transaction per user with MIGRATION_SOURCE
 * - Separate from read XP: Uses 'migration_bonus' source, NOT 'chapter_read'
 * 
 * IMPORTANT: This does NOT trigger read telemetry - migration is trusted
 */
export async function awardMigrationBonus(
  userId: string,
  importedChapters: number
): Promise<MigrationBonusResult> {
  // Calculate XP using the clamp formula: clamp(chapters * 0.25, 50, 500)
  const xpToAward = calculateMigrationBonus(importedChapters)

  // Early return if no chapters imported (or negative)
  if (importedChapters <= 0) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true, level: true }
    })
    return {
      awarded: false,
      xpAwarded: 0,
      chaptersImported: importedChapters,
      alreadyAwarded: false,
      newLevel: user?.level || 1,
      newXp: user?.xp || 0
    }
  }

  // Atomic insert with ON CONFLICT to prevent race conditions
  // This ensures only ONE migration bonus ever gets awarded
  const result = await prisma.$transaction(async (tx) => {
    // Try to insert - will fail silently if already exists
    const inserted = await tx.$executeRawUnsafe(
      `INSERT INTO xp_transactions (user_id, amount, source, source_id, description)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM xp_transactions WHERE user_id = $1 AND source = $3
       )`,
      userId,
      xpToAward,
      MIGRATION_SOURCE,
      `import_${Date.now()}`,
      `Migration bonus: ${importedChapters} chapters imported (${MIGRATION_XP_PER_CHAPTER} XP each, min ${MIGRATION_XP_MIN}, max ${MIGRATION_XP_CAP})`
    )

    // If no row inserted, bonus was already awarded
    if (inserted === 0) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { xp: true, level: true }
      })
      return {
        awarded: false,
        xpAwarded: 0,
        chaptersImported: importedChapters,
        alreadyAwarded: true,
        newLevel: user?.level || 1,
        newXp: user?.xp || 0
      }
    }

    // Bonus was awarded - update user XP
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { xp: true }
    })

    if (!user) {
      throw new Error("User not found")
    }

    const newXp = addXp(user.xp || 0, xpToAward)
    const newLevel = calculateLevel(newXp)

    await tx.user.update({
      where: { id: userId },
      data: {
        xp: newXp,
        level: newLevel
      }
    })

    // NOTE: We intentionally do NOT:
    // - Record chapter_read events (no telemetry pollution)
    // - Update user_chapter_reads_v2 (no fake read markers)
    // - Affect trust_score (migration is trusted)

    return {
      awarded: true,
      xpAwarded: xpToAward,
      chaptersImported: importedChapters,
      alreadyAwarded: false,
      newLevel,
      newXp
    }
  })

  return result
}

/**
 * Award migration bonus within an existing transaction
 * Use this when integrating with import pipeline
 * 
 * RULES ENFORCED:
 * - One-time: Atomic insert with NOT EXISTS check
 * - Non-repeatable: Only ONE transaction per user with MIGRATION_SOURCE
 * - Separate from read XP: Uses 'migration_bonus' source, NOT 'chapter_read'
 */
export async function awardMigrationBonusInTransaction(
  tx: TransactionClient,
  userId: string,
  importedChapters: number
): Promise<MigrationBonusResult> {
  // Calculate XP using the clamp formula: clamp(chapters * 0.25, 50, 500)
  const xpToAward = calculateMigrationBonus(importedChapters)

  if (importedChapters <= 0) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { xp: true, level: true }
    })
    return {
      awarded: false,
      xpAwarded: 0,
      chaptersImported: importedChapters,
      alreadyAwarded: false,
      newLevel: user?.level || 1,
      newXp: user?.xp || 0
    }
  }

  // Atomic check-and-insert
  const inserted = await tx.$executeRawUnsafe(
    `INSERT INTO xp_transactions (user_id, amount, source, source_id, description)
     SELECT $1, $2, $3, $4, $5
     WHERE NOT EXISTS (
       SELECT 1 FROM xp_transactions WHERE user_id = $1 AND source = $3
     )`,
    userId,
    xpToAward,
    MIGRATION_SOURCE,
    `import_${Date.now()}`,
    `Migration bonus: ${importedChapters} chapters imported`
  )

  if ((inserted as number) === 0) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { xp: true, level: true }
    })
    return {
      awarded: false,
      xpAwarded: 0,
      chaptersImported: importedChapters,
      alreadyAwarded: true,
      newLevel: user?.level || 1,
      newXp: user?.xp || 0
    }
  }

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { xp: true }
  })

  const newXp = addXp(user?.xp || 0, xpToAward)
  const newLevel = calculateLevel(newXp)

  await tx.user.update({
    where: { id: userId },
    data: { xp: newXp, level: newLevel }
  })

  return {
    awarded: true,
    xpAwarded: xpToAward,
    chaptersImported: importedChapters,
    alreadyAwarded: false,
    newLevel,
    newXp
  }
}

/**
 * Get migration bonus transaction history for a user
 */
export async function getMigrationBonusHistory(userId: string) {
  const transactions = await prisma.$queryRawUnsafe<{
    id: string
    amount: number
    description: string
    created_at: Date
  }[]>(
    `SELECT id, amount, description, created_at 
     FROM xp_transactions 
     WHERE user_id = $1 AND source = $2
     ORDER BY created_at DESC`,
    userId,
    MIGRATION_SOURCE
  )
  return transactions
}

/**
 * Check if user has already received migration bonus
 */
export async function hasMigrationBonus(userId: string): Promise<boolean> {
  return !(await checkMigrationBonusEligibility(userId))
}
