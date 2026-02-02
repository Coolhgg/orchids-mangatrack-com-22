import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFollowers } from "@/lib/social-utils";
import { checkRateLimit, validateUsername, parsePaginationParams, handleApiError, getClientIp, ApiError, ErrorCodes } from "@/lib/api-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    // Rate limit: 30 requests per minute per IP
    const ip = getClientIp(request);
    if (!await checkRateLimit(`followers:${ip}`, 30, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { username } = await params;

    // Validate username format to prevent injection
    if (!validateUsername(username)) {
      return NextResponse.json(
        { error: "Invalid username format" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePaginationParams(searchParams);

    const followers = await getFollowers(username, { page, limit }, user?.id);

    return NextResponse.json(followers);
  } catch (error: any) {
    return handleApiError(error);
  }
}
