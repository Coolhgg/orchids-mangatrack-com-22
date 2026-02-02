import { z } from 'zod';

/**
 * Schema for syncing a series source (SyncSourceQueue)
 * Used in master.scheduler.ts
 */
export const SyncSourceSchema = z.object({
  seriesSourceId: z.string().uuid({ message: "Must be a valid UUID" }),
});

/**
 * Schema for checking a search source (CheckSourceQueue)
 * Used in deferred-search.scheduler.ts and search API
 */
export const CheckSourceSchema = z.object({
  query: z.string().min(1, { message: "Search query cannot be empty" }),
  intent: z.any().optional(),
  trigger: z.string().optional(),
  isPremium: z.boolean().optional(),
});

/**
 * Schema for resolving an unresolved series (SeriesResolutionQueue)
 */
export const SeriesResolutionSchema = z.object({
  seriesId: z.string().uuid().optional(),
  libraryEntryId: z.string().uuid().optional(),
  source_url: z.string().optional(),
  title: z.string().optional()
});

export type SyncSourcePayload = z.infer<typeof SyncSourceSchema>;
export type CheckSourcePayload = z.infer<typeof CheckSourceSchema>;
export type SeriesResolutionPayload = z.infer<typeof SeriesResolutionSchema>;
