import { z } from 'zod';

// Strict string validation to prevent injection
const safeString = z.string().max(100).regex(/^[\w\s\-.,!']+$/i).optional();
const safeStringArray = z.array(z.string().max(100).regex(/^[\w\s\-.,!']+$/i)).max(50).default([]);

export const FilterSchema = z.object({
  q: z.string().max(200).nullable().default(null),
  type: safeStringArray,
  genres: safeStringArray,
  tags: safeStringArray,
  themes: safeStringArray,
  contentWarnings: z.object({
    include: safeStringArray,
    exclude: safeStringArray,
  }).default({ include: [], exclude: [] }),
  publicationStatus: safeStringArray,
  contentRating: safeStringArray,
  readableOn: safeStringArray,
  languages: z.object({
    original: z.string().max(10).optional(),
    translated: z.array(z.string().max(10)).max(20).default([]),
  }).default({ translated: [] }),
  chapterCount: z.object({
    min: z.number().int().min(0).max(100000).optional(),
    max: z.number().int().min(0).max(100000).optional(),
  }).optional().refine(
    (data) => !data || data.min === undefined || data.max === undefined || data.min <= data.max,
    { message: "min must be less than or equal to max" }
  ),
  releasePeriod: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }).optional().refine(
    (data) => !data || !data.from || !data.to || new Date(data.from) <= new Date(data.to),
    { message: "from date must be before to date" }
  ),
  sortBy: z.enum(['newest', 'updated', 'latest_chapter', 'popularity', 'score', 'chapters', 'views', 'follows']).default('latest_chapter'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  cursor: z.string().max(500).nullable().optional(),
  limit: z.number().int().min(1).max(100).default(24),
  mode: z.enum(['any', 'all']).default('all'),
});

export type CanonicalFilter = z.infer<typeof FilterSchema>;

export const DEFAULT_FILTERS: CanonicalFilter = {
  q: null,
  type: [],
  genres: [],
  tags: [],
  themes: [],
  contentWarnings: { include: [], exclude: [] },
  publicationStatus: [],
  contentRating: [],
  readableOn: [],
    languages: { translated: [] },
    sortBy: 'latest_chapter',
    sortOrder: 'desc',
    limit: 24,
    mode: 'all',
  };
