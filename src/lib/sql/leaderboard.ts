import { prisma } from "@/lib/prisma"

export interface LeaderboardEntry {
  rank: number
  id: string
  username: string
  avatar_url: string | null
  xp: number
  level: number
  streak_days: number
  chapters_read: number
  season_xp: number
  effective_xp: number
}

export interface SeasonalLeaderboardEntry extends LeaderboardEntry {
  season_id: string
  season_code: string
}

export const LEADERBOARD_QUERIES = {
  SEASONAL: `
    SELECT
      ROW_NUMBER() OVER (ORDER BY (us.xp * u.trust_score) DESC) AS rank,
      u.id,
      u.username,
      u.avatar_url,
      u.xp,
      u.level,
      u.streak_days,
      u.chapters_read,
      us.xp AS season_xp,
      FLOOR(us.xp * u.trust_score) AS effective_xp,
      s.id AS season_id,
      s.code AS season_code
    FROM user_season_xp us
    JOIN users u ON u.id = us.user_id
    JOIN seasons s ON s.id = us.season_id
    WHERE s.is_active = true
      AND u.deleted_at IS NULL
    ORDER BY effective_xp DESC
    LIMIT $1
  `,

  SEASONAL_BY_CODE: `
    SELECT
      ROW_NUMBER() OVER (ORDER BY (us.xp * u.trust_score) DESC) AS rank,
      u.id,
      u.username,
      u.avatar_url,
      u.xp,
      u.level,
      u.streak_days,
      u.chapters_read,
      us.xp AS season_xp,
      FLOOR(us.xp * u.trust_score) AS effective_xp,
      s.id AS season_id,
      s.code AS season_code
    FROM user_season_xp us
    JOIN users u ON u.id = us.user_id
    JOIN seasons s ON s.id = us.season_id
    WHERE s.code = $1
      AND u.deleted_at IS NULL
    ORDER BY effective_xp DESC
    LIMIT $2
  `,

  ALL_TIME: `
    SELECT
      ROW_NUMBER() OVER (ORDER BY (u.xp * u.trust_score) DESC) AS rank,
      u.id,
      u.username,
      u.avatar_url,
      u.xp,
      u.level,
      u.streak_days,
      u.chapters_read,
      u.season_xp,
      FLOOR(u.xp * u.trust_score) AS effective_xp
    FROM users u
    WHERE u.deleted_at IS NULL
      AND u.xp > 0
    ORDER BY effective_xp DESC
    LIMIT $1
  `,

  STREAK: `
    SELECT
      ROW_NUMBER() OVER (ORDER BY u.streak_days DESC) AS rank,
      u.id,
      u.username,
      u.avatar_url,
      u.xp,
      u.level,
      u.streak_days,
      u.chapters_read,
      u.season_xp,
      u.xp AS effective_xp
    FROM users u
    WHERE u.deleted_at IS NULL
      AND u.streak_days > 0
    ORDER BY u.streak_days DESC
    LIMIT $1
  `,

  CHAPTERS: `
    SELECT
      ROW_NUMBER() OVER (ORDER BY u.chapters_read DESC) AS rank,
      u.id,
      u.username,
      u.avatar_url,
      u.xp,
      u.level,
      u.streak_days,
      u.chapters_read,
      u.season_xp,
      u.xp AS effective_xp
    FROM users u
    WHERE u.deleted_at IS NULL
      AND u.chapters_read > 0
    ORDER BY u.chapters_read DESC
    LIMIT $1
  `,

  EFFICIENCY: `
    SELECT
      ROW_NUMBER() OVER (ORDER BY (FLOOR(u.xp * u.trust_score) / GREATEST(u.active_days, 1)) DESC) AS rank,
      u.id,
      u.username,
      u.avatar_url,
      u.xp,
      u.level,
      u.streak_days,
      u.chapters_read,
      u.season_xp,
      FLOOR(u.xp * u.trust_score) AS effective_xp,
      ROUND((u.xp * u.trust_score) / GREATEST(u.active_days, 1)::numeric, 2) AS xp_per_day
    FROM users u
    WHERE u.deleted_at IS NULL
      AND u.xp > 0
      AND u.active_days > 0
    ORDER BY xp_per_day DESC
    LIMIT $1
  `,

  USER_RANK_ALL_TIME: `
    SELECT rank FROM (
      SELECT
        u.id,
        ROW_NUMBER() OVER (ORDER BY (u.xp * u.trust_score) DESC) AS rank
      FROM users u
      WHERE u.deleted_at IS NULL AND u.xp > 0
    ) ranked
    WHERE id = $1
  `,

  USER_RANK_SEASONAL: `
    SELECT rank FROM (
      SELECT
        us.user_id AS id,
        ROW_NUMBER() OVER (ORDER BY (us.xp * u.trust_score) DESC) AS rank
      FROM user_season_xp us
      JOIN users u ON u.id = us.user_id
      JOIN seasons s ON s.id = us.season_id
      WHERE s.is_active = true AND u.deleted_at IS NULL
    ) ranked
    WHERE id = $1
  `,
} as const

export async function getSeasonalLeaderboard(limit: number = 100): Promise<SeasonalLeaderboardEntry[]> {
  const results = await prisma.$queryRawUnsafe<SeasonalLeaderboardEntry[]>(
    LEADERBOARD_QUERIES.SEASONAL,
    limit
  )
  return results.map(r => ({
    ...r,
    rank: Number(r.rank),
    xp: Number(r.xp),
    level: Number(r.level),
    streak_days: Number(r.streak_days),
    chapters_read: Number(r.chapters_read),
    season_xp: Number(r.season_xp),
    effective_xp: Number(r.effective_xp),
  }))
}

export async function getSeasonalLeaderboardByCode(
  seasonCode: string,
  limit: number = 100
): Promise<SeasonalLeaderboardEntry[]> {
  const results = await prisma.$queryRawUnsafe<SeasonalLeaderboardEntry[]>(
    LEADERBOARD_QUERIES.SEASONAL_BY_CODE,
    seasonCode,
    limit
  )
  return results.map(r => ({
    ...r,
    rank: Number(r.rank),
    xp: Number(r.xp),
    level: Number(r.level),
    streak_days: Number(r.streak_days),
    chapters_read: Number(r.chapters_read),
    season_xp: Number(r.season_xp),
    effective_xp: Number(r.effective_xp),
  }))
}

export async function getAllTimeLeaderboard(limit: number = 100): Promise<LeaderboardEntry[]> {
  const results = await prisma.$queryRawUnsafe<LeaderboardEntry[]>(
    LEADERBOARD_QUERIES.ALL_TIME,
    limit
  )
  return results.map(r => ({
    ...r,
    rank: Number(r.rank),
    xp: Number(r.xp),
    level: Number(r.level),
    streak_days: Number(r.streak_days),
    chapters_read: Number(r.chapters_read),
    season_xp: Number(r.season_xp),
    effective_xp: Number(r.effective_xp),
  }))
}

export async function getStreakLeaderboard(limit: number = 100): Promise<LeaderboardEntry[]> {
  const results = await prisma.$queryRawUnsafe<LeaderboardEntry[]>(
    LEADERBOARD_QUERIES.STREAK,
    limit
  )
  return results.map(r => ({
    ...r,
    rank: Number(r.rank),
    xp: Number(r.xp),
    level: Number(r.level),
    streak_days: Number(r.streak_days),
    chapters_read: Number(r.chapters_read),
    season_xp: Number(r.season_xp),
    effective_xp: Number(r.effective_xp),
  }))
}

export async function getChaptersLeaderboard(limit: number = 100): Promise<LeaderboardEntry[]> {
  const results = await prisma.$queryRawUnsafe<LeaderboardEntry[]>(
    LEADERBOARD_QUERIES.CHAPTERS,
    limit
  )
  return results.map(r => ({
    ...r,
    rank: Number(r.rank),
    xp: Number(r.xp),
    level: Number(r.level),
    streak_days: Number(r.streak_days),
    chapters_read: Number(r.chapters_read),
    season_xp: Number(r.season_xp),
    effective_xp: Number(r.effective_xp),
  }))
}

export async function getEfficiencyLeaderboard(limit: number = 100): Promise<(LeaderboardEntry & { xp_per_day: number })[]> {
  const results = await prisma.$queryRawUnsafe<(LeaderboardEntry & { xp_per_day: number })[]>(
    LEADERBOARD_QUERIES.EFFICIENCY,
    limit
  )
  return results.map(r => ({
    ...r,
    rank: Number(r.rank),
    xp: Number(r.xp),
    level: Number(r.level),
    streak_days: Number(r.streak_days),
    chapters_read: Number(r.chapters_read),
    season_xp: Number(r.season_xp),
    effective_xp: Number(r.effective_xp),
    xp_per_day: Number(r.xp_per_day),
  }))
}

export async function getUserRank(userId: string, type: 'all-time' | 'seasonal' = 'all-time'): Promise<number | null> {
  const query = type === 'seasonal' 
    ? LEADERBOARD_QUERIES.USER_RANK_SEASONAL 
    : LEADERBOARD_QUERIES.USER_RANK_ALL_TIME
  
  const results = await prisma.$queryRawUnsafe<{ rank: bigint }[]>(query, userId)
  return results.length > 0 ? Number(results[0].rank) : null
}
