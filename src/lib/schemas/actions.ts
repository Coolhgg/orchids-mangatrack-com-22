import { z } from 'zod'

export const UUIDSchema = z.string().uuid('Invalid UUID format')
export const StatusSchema = z.enum(['reading', 'completed', 'planning', 'dropped', 'paused'])
export const ChapterSchema = z.number().min(0).max(100000).finite()
export const RatingSchema = z.number().int().min(1).max(10)
