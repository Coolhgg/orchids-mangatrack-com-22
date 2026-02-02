import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActivityFeed } from "@/lib/social-utils";
import { checkRateLimit, handleApiError, ApiError, ErrorCodes, getClientIp } from "@/lib/api-utils";

const VALID_TYPES = ['global', 'following'] as const;

export async function GET(request: Request) {
  try {
    // Rate limit
    const ip = getClientIp(request);
    if (!await checkRateLimit(`feed:${ip}`, 60, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "20")), 50);
    // BUG-002 FIX: Add upper bound to offset to prevent DB strain and integer overflow
    const MAX_OFFSET = 10000;
    const offset = Math.min(MAX_OFFSET, Math.max(0, parseInt(searchParams.get("offset") || "0")));
    const actualPage = offset > 0 ? Math.floor(offset / limit) + 1 : page;
    const type = searchParams.get("type") || (user ? "following" : "global");

    // Validate type
    if (!VALID_TYPES.includes(type as any)) {
      throw new ApiError(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    if (type === "following" && !user) {
      throw new ApiError("Unauthorized. Sign in to view your following feed.", 401, ErrorCodes.UNAUTHORIZED);
    }

    const feed = await getActivityFeed(user?.id || null, {
      page: actualPage,
      limit,
      type: type as "global" | "following",
      viewerId: user?.id,
    });

    return NextResponse.json(feed);
  } catch (error: any) {
    return handleApiError(error);
  }
}
