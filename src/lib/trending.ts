import { prisma } from "./prisma";

export interface VelocityStats {
  chapters_24h: number;
  chapters_72h: number;
  follows_24h: number;
  follows_72h: number;
  activity_24h: number;
  v_chapters: number;
  v_follows: number;
  v_activity: number;
  raw_velocity_score: number;
  recency_factor: number;
  trending_score: number;
}

export interface TrendingStats {
  activity_7d: number;
  followers_7d: number;
  velocity: number;
  trending_score: number;
}

const VELOCITY_WEIGHTS = {
  CHAPTERS_24H: 2.0,
  CHAPTERS_72H: 0.5,
  FOLLOWS_24H: 1.5,
  FOLLOWS_72H: 0.3,
  ACTIVITY_24H: 1.0,
  V_CHAPTERS_WEIGHT: 0.50,
  V_FOLLOWS_WEIGHT: 0.35,
  V_ACTIVITY_WEIGHT: 0.15,
} as const;

export async function calculateVelocityScore(seriesId: string): Promise<VelocityStats> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);

  const [chapters, follows, activity] = await Promise.all([
    prisma.chapter.findMany({
      where: {
        series_id: seriesId,
        first_detected_at: { gte: seventyTwoHoursAgo },
        deleted_at: null
      },
      select: { first_detected_at: true }
    }),
    prisma.libraryEntry.findMany({
      where: {
        series_id: seriesId,
        added_at: { gte: seventyTwoHoursAgo },
        deleted_at: null
      },
      select: { added_at: true }
    }),
    prisma.seriesActivityEvent.count({
      where: {
        series_id: seriesId,
        created_at: { gte: twentyFourHoursAgo },
        event_type: { in: ['user_read', 'update_click', 'chapter_read'] }
      }
    })
  ]);

  const chapters_24h = chapters.filter(c => c.first_detected_at && c.first_detected_at >= twentyFourHoursAgo).length;
  const chapters_72h = chapters.length;
  const follows_24h = follows.filter(f => f.added_at >= twentyFourHoursAgo).length;
  const follows_72h = follows.length;
  const activity_24h = activity;

  const v_chapters = (chapters_24h * VELOCITY_WEIGHTS.CHAPTERS_24H) + (chapters_72h * VELOCITY_WEIGHTS.CHAPTERS_72H);
  const v_follows = (follows_24h * VELOCITY_WEIGHTS.FOLLOWS_24H) + (follows_72h * VELOCITY_WEIGHTS.FOLLOWS_72H);
  const v_activity = activity_24h * VELOCITY_WEIGHTS.ACTIVITY_24H;

  const raw_velocity_score = 
    (v_chapters * VELOCITY_WEIGHTS.V_CHAPTERS_WEIGHT) +
    (v_follows * VELOCITY_WEIGHTS.V_FOLLOWS_WEIGHT) +
    (v_activity * VELOCITY_WEIGHTS.V_ACTIVITY_WEIGHT);

  const lastChapter = chapters.length > 0 
    ? chapters.reduce((latest, c) => 
        c.first_detected_at && (!latest || c.first_detected_at > latest) ? c.first_detected_at : latest, 
        null as Date | null
      )
    : null;

  const daysSinceLastChapter = lastChapter 
    ? (now.getTime() - lastChapter.getTime()) / (1000 * 60 * 60 * 24)
    : 1;
  
  const recency_factor = 1.0 / (1.0 + daysSinceLastChapter);
  const trending_score = raw_velocity_score * recency_factor;

  return {
    chapters_24h,
    chapters_72h,
    follows_24h,
    follows_72h,
    activity_24h,
    v_chapters,
    v_follows,
    v_activity,
    raw_velocity_score,
    recency_factor,
    trending_score
  };
}

export async function calculateTrendingScore(seriesId: string): Promise<TrendingStats> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [activity, followers, chapters] = await Promise.all([
    prisma.seriesActivityEvent.aggregate({
      _sum: { weight: true },
      where: {
        series_id: seriesId,
        created_at: { gte: sevenDaysAgo }
      }
    }),
    prisma.libraryEntry.count({
      where: {
        series_id: seriesId,
        added_at: { gte: sevenDaysAgo },
        deleted_at: null
      }
    }),
    prisma.chapter.findMany({
      where: {
        series_id: seriesId,
        first_detected_at: { gte: thirtyDaysAgo },
        deleted_at: null
      },
      select: { first_detected_at: true }
    })
  ]);

  const activity_7d = Number(activity._sum.weight || 0);
  const followers_7d = followers;
  
  const chapters_7d = chapters.filter(c => c.first_detected_at && c.first_detected_at >= sevenDaysAgo).length;
  const chapters_30d = chapters.length;
  const velocity = chapters_30d > 0 ? chapters_7d / chapters_30d : 0;

  const trending_score = (activity_7d * 0.6) + (followers_7d * 0.3) + (velocity * 0.1);

  return {
    activity_7d,
    followers_7d,
    velocity,
    trending_score
  };
}
