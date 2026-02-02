const fs = require('fs');
const path = require('path');

const schemaPath = path.join(process.cwd(), 'prisma/schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

const mappings = [
  { model: 'Achievement', table: 'achievements' },
  { model: 'Activity', table: 'activities' },
  { model: 'ActivityEvent', table: 'activity_events' },
  { model: 'AuditLog', table: 'audit_logs' },
  { model: 'ChapterLinkReport', table: 'chapter_link_reports' },
  { model: 'ChapterLink', table: 'chapter_links' },
  { model: 'ChapterSource', table: 'chapter_sources' },
  { model: 'Chapter', table: 'chapters' },
  { model: 'Creator', table: 'creators' },
  { model: 'FeedEntry', table: 'feed_entries' },
  { model: 'ImportItem', table: 'import_items' },
  { model: 'ImportJob', table: 'import_jobs' },
  { model: 'LibraryEntry', table: 'library_entries' },
  { model: 'LogicalChapter', table: 'logical_chapters' },
  { model: 'NotificationDigestBuffer', table: 'notification_digest_buffer' },
  { model: 'Notification', table: 'notifications' },
  { model: 'SeriesActivityEvent', table: 'series_activity_events' },
  { model: 'SeriesCreator', table: 'series_creators' },
  { model: 'SeriesRelation', table: 'series_relations' },
  { model: 'SeriesSource', table: 'series_sources' },
  { model: 'SeriesStat', table: 'series_stats' },
  { model: 'Series', table: 'series' },
  { model: 'TrustViolation', table: 'trust_violations' },
  { model: 'UserAchievement', table: 'user_achievements' },
  { model: 'UserAvailabilityFeed', table: 'user_availability_feed' },
  { model: 'UserChapterReadV2', table: 'user_chapter_reads_v2' },
  { model: 'UserRecommendation', table: 'user_recommendations' },
  { model: 'UserSeasonXp', table: 'user_season_xp' },
  { model: 'UserSeriesSourcePreference', table: 'user_series_source_preferences' },
  { model: 'UserSignal', table: 'user_signals' },
  { model: 'UserSourcePriority', table: 'user_source_priorities' },
  { model: 'XpTransaction', table: 'xp_transactions' },
  { model: 'WorkerFailure', table: 'worker_failures' },
  { model: 'Season', table: 'seasons' },
  { model: 'SeasonalUserAchievement', table: 'seasonal_user_achievements' },
  { model: 'UserChapterRead', table: 'user_chapter_reads' },
];

const renames = [
  { old: 'availability_events', new: 'AvailabilityEvent', table: 'availability_events' },
  { old: 'chapter_availability', new: 'ChapterAvailability', table: 'chapter_availability' },
  { old: 'chapter_availability_events', new: 'ChapterAvailabilityEvent', table: 'chapter_availability_events' },
  { old: 'data_operation_reports', new: 'DataOperationReport', table: 'data_operation_reports' },
  { old: 'dmca_requests', new: 'DmcaRequest', table: 'dmca_requests' },
  { old: 'domain_blacklist', new: 'DomainBlacklist', table: 'domain_blacklist' },
  { old: 'link_submission_audit', new: 'LinkSubmissionAudit', table: 'link_submission_audit' },
  { old: 'login_attempts', new: 'LoginAttempt', table: 'login_attempts' },
  { old: 'mangaupdates_releases', new: 'MangaUpdatesRelease', table: 'mangaupdates_releases' },
  { old: 'notifications_queue', new: 'NotificationQueue', table: 'notifications_queue' },
  { old: 'query_stats', new: 'QueryStat', table: 'query_stats' },
  { old: 'read_telemetry', new: 'ReadTelemetry', table: 'read_telemetry' },
  { old: 'saved_filters', new: 'SavedFilter', table: 'saved_filters' },
  { old: 'scheduler_state', new: 'SchedulerState', table: 'scheduler_state' },
  { old: 'search_events', new: 'SearchEvent', table: 'search_events' },
  { old: 'seed_list_entries', new: 'SeedListEntry', table: 'seed_list_entries' },
  { old: 'seed_lists', new: 'SeedList', table: 'seed_lists' },
  { old: 'source_configs', new: 'SourceConfig', table: 'source_configs' },
  { old: 'sync_tasks', new: 'SyncTask', table: 'sync_tasks' },
  { old: 'user_affinities', new: 'UserAffinity', table: 'user_affinities' },
];

// 1. Handle renames first
renames.forEach(({ old, new: newName, table }) => {
  const modelRegex = new RegExp(`model\\s+${old}\\s+{`, 'g');
  schema = schema.replace(modelRegex, `model ${newName} {`);
  
  // Update types
  const typeRegex = new RegExp(`(?<=\\s)${old}(?=[\\s\\[\\?])`, 'g');
  schema = schema.replace(typeRegex, newName);
  
  // Add to mappings
  mappings.push({ model: newName, table });
});

// 2. Add @@map to models if not present
mappings.forEach(({ model, table }) => {
  const modelStartRegex = new RegExp(`model\\s+${model}\\s+{`, 'g');
  if (schema.match(modelStartRegex)) {
    // Find the end of the model block
    const parts = schema.split(modelStartRegex);
    if (parts.length > 1) {
      const modelContent = parts[1].split('}')[0];
      if (!modelContent.includes('@@map')) {
        // Add @@map before the closing brace or existing @@schema
        if (modelContent.includes('@@schema')) {
          parts[1] = parts[1].replace('@@schema', `@@map("${table}")\n  @@schema`);
        } else {
          // If no @@schema, add at the end of content
          const lastLineMatch = modelContent.trim().match(/.*\n?$/);
          parts[1] = parts[1].replace(modelContent, modelContent.trimEnd() + `\n\n  @@map("${table}")\n`);
        }
        schema = parts.join(`model ${model} {`);
      }
    }
  }
});

fs.writeFileSync(schemaPath, schema);
console.log('Schema mappings fixed');
