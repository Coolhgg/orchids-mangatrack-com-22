import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNotifications, markNotificationsAsRead } from "@/lib/social-utils";
import { checkRateLimit, validateOrigin, handleApiError, ApiError, ErrorCodes, getClientIp, validateContentType, validateJsonSize } from "@/lib/api-utils";
import { z } from "zod";
import { logger } from "@/lib/logger";

const VALID_TYPES = [
  'new_chapter',
  'new_follower',
  'achievement',
  'level_up',
  'streak_milestone',
  'season_rank',
  'season_ending',
  'system',
] as const;

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  unreadOnly: z.preprocess((val) => val === 'true', z.boolean()).default(false),
  type: z.enum(VALID_TYPES).optional(),
});

const markAllSchema = z.object({
  markAll: z.literal(true),
});

export async function GET(request: NextRequest) {
  try {
    // Rate limit
    const ip = getClientIp(request);
    if (!await checkRateLimit(`notifications:${ip}`, 60, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError('Unauthorized', 401, ErrorCodes.UNAUTHORIZED);
    }

    const { searchParams } = new URL(request.url);
    const validatedQuery = querySchema.safeParse(Object.fromEntries(searchParams));
    
    if (!validatedQuery.success) {
      throw new ApiError(validatedQuery.error.errors[0].message, 400, ErrorCodes.VALIDATION_ERROR);
    }

    const { page, limit, unreadOnly, type } = validatedQuery.data;

    const notifications = await getNotifications(user.id, {
      page,
      limit,
      unreadOnly,
      type,
    });

    return NextResponse.json(notifications);
    } catch (error: unknown) {
      logger.error('Notifications fetch error', { error: error instanceof Error ? error.message : String(error) });
      return handleApiError(error);
    }
}

export async function PATCH(request: NextRequest) {
  try {
    // CSRF Protection
    validateOrigin(request);

    // BUG 58: Validate Content-Type
    validateContentType(request);

      // BUG 57: Validate JSON Size (clone request to avoid consuming body)
      await validateJsonSize(request.clone());

    // Rate limit: 30 requests per minute per IP
    const ip = getClientIp(request);
    if (!await checkRateLimit(`notifications-mark:${ip}`, 30, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError('Unauthorized', 401, ErrorCodes.UNAUTHORIZED);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, ErrorCodes.BAD_REQUEST);
    }

    const validatedBody = markAllSchema.safeParse(body);
    if (!validatedBody.success) {
      throw new ApiError("Invalid request. Use { markAll: true } to mark all as read", 400, ErrorCodes.VALIDATION_ERROR);
    }

    await markNotificationsAsRead(user.id);

    return NextResponse.json({ success: true });
    } catch (error: unknown) {
      logger.error('Notifications update error', { error: error instanceof Error ? error.message : String(error) });
      return handleApiError(error);
    }
}
