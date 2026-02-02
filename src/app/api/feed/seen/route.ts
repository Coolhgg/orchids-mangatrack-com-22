import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, handleApiError, ApiError, ErrorCodes, validateOrigin, validateContentType, validateJsonSize } from "@/lib/api-utils"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  try {
    // CSRF Protection
    validateOrigin(request);

    // BUG 58: Validate Content-Type
    validateContentType(request);

    // BUG 57: Validate JSON Size
    await validateJsonSize(request);

    const ip = getClientIp(request);
    if (!await checkRateLimit(`feed-seen:${ip}`, 30, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    const { last_seen_at } = await request.json();
    const newTimestamp = last_seen_at ? new Date(last_seen_at) : new Date();

    // Only update if the new timestamp is further in the future
    await prisma.user.update({
      where: { 
        id: user.id,
        OR: [
          { feed_last_seen_at: null },
          { feed_last_seen_at: { lt: newTimestamp } }
        ]
      },
      data: {
        feed_last_seen_at: newTimestamp
      }
    }).catch(err => {
      // If the record wasn't updated because of the LT condition, it's fine
      console.log("Watermark not updated (already ahead):", err.message);
    });

    return NextResponse.json({ success: true, feed_last_seen_at: newTimestamp.toISOString() });
  } catch (error) {
    return handleApiError(error);
  }
}
