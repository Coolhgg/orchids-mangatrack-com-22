import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { followUser, unfollowUser, checkFollowStatus } from "@/lib/social-utils";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, validateUsername, withErrorHandling, ApiError, ErrorCodes, validateOrigin, getClientIp, logSecurityEvent } from "@/lib/api-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  return withErrorHandling(async () => {
    // Rate limit: 60 requests per minute per IP
    const ip = getClientIp(request);
    if (!await checkRateLimit(`follow-status:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    const { username } = await params;

    // Validate username format
    if (!validateUsername(username)) {
      throw new ApiError("Invalid username format", 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Get target user ID with case-insensitivity
    const target = await prisma.user.findFirst({
      where: { 
        username: { 
          equals: username, 
          mode: 'insensitive' 
        } 
      },
      select: { id: true },
    });

    if (!target) {
      throw new ApiError("User not found", 404, ErrorCodes.NOT_FOUND);
    }

    const isFollowing = await checkFollowStatus(user.id, target.id);

    return { isFollowing };
  })
}

  export async function POST(
    request: Request,
    { params }: { params: Promise<{ username: string }> }
  ) {
    return withErrorHandling(async () => {
      // CSRF Protection
      validateOrigin(request);
      
      // BUG 58: Validate Content-Type
      validateContentType(request);

    // Rate limit: 30 follow actions per minute per IP
    const ip = getClientIp(request);
    if (!await checkRateLimit(`follow-action:${ip}`, 30, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    const { username } = await params;

    // Validate username format
    if (!validateUsername(username)) {
      throw new ApiError("Invalid username format", 400, ErrorCodes.VALIDATION_ERROR);
    }

    const result = await followUser(user.id, username);

    // Log the event
    await logSecurityEvent({
      userId: user.id,
      event: 'SOCIAL_FOLLOW',
      status: 'success',
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      metadata: { target_username: username }
    });

    const response: Record<string, unknown> = { ...result.follow };
    
    if (result.unlockedAchievements.length > 0) {
      response.xpGained = 0;
      response.achievements = result.unlockedAchievements.map(a => ({
        code: a.code,
        name: a.name,
        xp_reward: a.xp_reward,
        rarity: a.rarity,
      }));
    }

    return NextResponse.json(response, { status: 201 });
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  return withErrorHandling(async () => {
    // CSRF Protection
    validateOrigin(request);

    const ip = getClientIp(request);
    if (!await checkRateLimit(`follow-action:${ip}`, 30, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    const { username } = await params;

    // Validate username format
    if (!validateUsername(username)) {
      throw new ApiError("Invalid username format", 400, ErrorCodes.VALIDATION_ERROR);
    }

    await unfollowUser(user.id, username);

    // Log the event
    await logSecurityEvent({
      userId: user.id,
      event: 'SOCIAL_UNFOLLOW',
      status: 'success',
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      metadata: { target_username: username }
    });

    return { success: true };
  })
}
