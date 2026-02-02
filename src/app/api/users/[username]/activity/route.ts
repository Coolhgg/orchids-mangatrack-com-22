import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActivityFeed } from "@/lib/social-utils";
import { prisma, withRetry } from "@/lib/prisma";
import { checkRateLimit, validateUsername, parsePaginationParams, handleApiError, ApiError, ErrorCodes, getClientIp } from "@/lib/api-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    // Rate limit: 30 requests per minute per IP
    const ip = getClientIp(request);
    if (!await checkRateLimit(`activity:${ip}`, 30, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { username } = await params;

    // Validate username format to prevent injection
    if (!validateUsername(username)) {
      throw new ApiError("Invalid username format", 400, ErrorCodes.VALIDATION_ERROR);
    }

    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePaginationParams(searchParams);

    // Get user ID from username with case-insensitivity
    const targetUser = await withRetry(
      () => prisma.user.findFirst({
        where: { 
          username: { 
            equals: username, 
            mode: 'insensitive' 
          } 
        },
        select: { id: true },
      }),
      2,
      200
    );

    if (!targetUser) {
      throw new ApiError("User not found", 404, ErrorCodes.NOT_FOUND);
    }

    const feed = await getActivityFeed(targetUser.id, {
      page,
      limit,
      type: "personal",
      viewerId: user?.id,
    });

    return NextResponse.json(feed);
  } catch (error: any) {
    return handleApiError(error);
  }
}
