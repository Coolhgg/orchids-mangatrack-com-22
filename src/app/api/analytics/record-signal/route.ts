import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, handleApiError, getClientIp, ApiError, ErrorCodes, validateOrigin, validateContentType, validateJsonSize } from "@/lib/api-utils"
import { recordSignal, SignalType } from "@/lib/analytics/signals"

// Valid UUID regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * API Route to record user behavior signals (implicit and explicit).
 * These signals drive the Recommendation Input Signal System.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  
  try {
    // Rate limiting: 200 signals per minute per IP
    if (!await checkRateLimit(`signal-record:${ip}`, 200, 60000)) {
      throw new ApiError('Too many requests', 429, ErrorCodes.RATE_LIMITED);
    }

    // Security & Validation
    validateOrigin(request);
    validateContentType(request);
    await validateJsonSize(request, 5 * 1024); // 5KB max payload

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      throw new ApiError('Unauthorized', 401, ErrorCodes.UNAUTHORIZED);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, ErrorCodes.BAD_REQUEST);
    }

    const { seriesId, signalType, metadata } = body;

    // Validate required fields
    if (!signalType) {
      throw new ApiError('Missing signalType', 400, ErrorCodes.BAD_REQUEST);
    }

    // Validate UUID format for seriesId if provided
    if (seriesId && !UUID_REGEX.test(seriesId)) {
      throw new ApiError('Invalid seriesId format', 400, ErrorCodes.VALIDATION_ERROR);
    }

    const validSignals: SignalType[] = [
      'manga_click',
      'chapter_click',
      'long_read_session',
      'repeat_visit',
      'add_to_library',
      'remove_from_library',
      'mark_chapter_read',
      'rating'
    ];

    if (!validSignals.includes(signalType as SignalType)) {
      throw new ApiError('Invalid signalType', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Record the signal
    await recordSignal({
      user_id: user.id,
      series_id: seriesId,
      signal_type: signalType as SignalType,
      metadata
    });

    return NextResponse.json({ success: true })

  } catch (error: any) {
    return handleApiError(error)
  }
}
