import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, handleApiError, getClientIp, ApiError, ErrorCodes, validateUUID, validateOrigin, validateContentType, validateJsonSize } from "@/lib/api-utils"
import { recordActivity, ActivityEventType } from "@/lib/analytics/record"

// Valid UUID regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  
  try {
    // Rate limiting
    if (!await checkRateLimit(`activity-record:${ip}`, 100, 60000)) {
      throw new ApiError('Too many requests', 429, ErrorCodes.RATE_LIMITED);
    }

    // CSRF Protection for state-changing request
    validateOrigin(request);

    // Content-Type validation
    validateContentType(request);

    // Payload size validation (prevent large payloads)
    await validateJsonSize(request, 10 * 1024); // 10KB max

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let body;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, ErrorCodes.BAD_REQUEST);
    }

    const { seriesId, eventType, chapterId, sourceName } = body;

    // Validate required fields
    if (!seriesId || !eventType) {
      throw new ApiError('Missing seriesId or eventType', 400, ErrorCodes.BAD_REQUEST);
    }

    // Validate UUID format for seriesId
    if (!UUID_REGEX.test(seriesId)) {
      throw new ApiError('Invalid seriesId format', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Validate chapterId if provided
    if (chapterId && !UUID_REGEX.test(chapterId)) {
      throw new ApiError('Invalid chapterId format', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Validate sourceName length if provided
    if (sourceName && (typeof sourceName !== 'string' || sourceName.length > 50)) {
      throw new ApiError('Invalid sourceName', 400, ErrorCodes.VALIDATION_ERROR);
    }

    const validEvents: ActivityEventType[] = [
      'chapter_read', 
      'series_followed', 
      'search_impression',
      'chapter_detected',
      'chapter_source_added'
    ]

    if (!validEvents.includes(eventType as ActivityEventType)) {
      throw new ApiError('Invalid eventType', 400, ErrorCodes.VALIDATION_ERROR);
    }

    await recordActivity({
      series_id: seriesId,
      user_id: user?.id,
      chapter_id: chapterId,
      source_name: sourceName,
      event_type: eventType as ActivityEventType
    })

    return NextResponse.json({ success: true })

  } catch (error: any) {
    return handleApiError(error)
  }
}
