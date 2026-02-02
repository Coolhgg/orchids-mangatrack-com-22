const fs = require('fs');
const path = require('path');

const schemaPath = path.join(process.cwd(), 'prisma/schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

const renames = [
  { old: 'public_users', new: 'User' },
  { old: 'series', new: 'Series' },
  { old: 'chapters', new: 'Chapter' },
  { old: 'library_entries', new: 'LibraryEntry' },
  { old: 'logical_chapters', new: 'LogicalChapter' },
  { old: 'user_series_source_preferences', new: 'UserSeriesSourcePreference' },
  { old: 'user_source_priorities', new: 'UserSourcePriority' },
  { old: 'user_chapter_reads_v2', new: 'UserChapterReadV2' },
  { old: 'series_sources', new: 'SeriesSource' },
  { old: 'chapter_sources', new: 'ChapterSource' },
  { old: 'import_jobs', new: 'ImportJob' },
  { old: 'import_items', new: 'ImportItem' },
  { old: 'trust_violations', new: 'TrustViolation' },
  { old: 'audit_logs', new: 'AuditLog' },
  { old: 'activities', new: 'Activity' },
  { old: 'notifications', new: 'Notification' },
  { old: 'xp_transactions', new: 'XpTransaction' },
  { old: 'user_achievements', new: 'UserAchievement' },
  { old: 'achievements', new: 'Achievement' },
  { old: 'seasons', new: 'Season' },
  { old: 'seasonal_user_achievements', new: 'SeasonalUserAchievement' },
  { old: 'worker_failures', new: 'WorkerFailure' },
  { old: 'notification_digest_buffer', new: 'NotificationDigestBuffer' },
  { old: 'feed_entries', new: 'FeedEntry' },
  { old: 'chapter_links', new: 'ChapterLink' },
  { old: 'chapter_link_reports', new: 'ChapterLinkReport' },
  { old: 'user_chapter_reads', new: 'UserChapterRead' },
  { old: 'activity_events', new: 'ActivityEvent' },
  { old: 'creators', new: 'Creator' },
  { old: 'series_creators', new: 'SeriesCreator' },
  { old: 'series_relations', new: 'SeriesRelation' },
  { old: 'series_stats', new: 'SeriesStat' },
  { old: 'series_activity_events', new: 'SeriesActivityEvent' },
  { old: 'user_signals', new: 'UserSignal' },
  { old: 'user_recommendations', new: 'UserRecommendation' },
  { old: 'user_season_xp', new: 'UserSeasonXp' },
  { old: 'user_availability_feed', new: 'UserAvailabilityFeed' },
];

// 1. Rename model definitions
renames.forEach(({ old, new: newName }) => {
  const modelRegex = new RegExp(`model\\s+${old}\\s+{`, 'g');
  schema = schema.replace(modelRegex, `model ${newName} {`);
});

// 2. Rename field types in other models (relations)
renames.forEach(({ old, new: newName }) => {
  const typeRegex = new RegExp(`(?<=\\s)${old}(?=[\\s\\[\\?])`, 'g');
  schema = schema.replace(typeRegex, newName);
});

fs.writeFileSync(schemaPath, schema);
console.log('Comprehensive schema update completed');
