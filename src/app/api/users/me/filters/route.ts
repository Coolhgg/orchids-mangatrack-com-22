import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { FilterSchema } from "@/lib/schemas/filters"
import { checkRateLimit, validateOrigin, sanitizeInput, handleApiError, ApiError, ErrorCodes, getClientIp, validateContentType, validateJsonSize, logSecurityEvent } from "@/lib/api-utils"

export async function GET(request: NextRequest) {
  try {
    // Rate limit: 30 requests per minute per IP
    const ip = getClientIp(request);
    if (!await checkRateLimit(`filters-get:${ip}`, 30, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED)
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)
    }

    const { data: filters, error } = await supabase
      .from('saved_filters')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50) // Prevent excessive data retrieval

    if (error) {
      console.error('[Filters GET] Database error:', error)
      throw new ApiError("Failed to fetch filters", 500, ErrorCodes.INTERNAL_ERROR)
    }

    return NextResponse.json(filters || [])
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    // CSRF Protection
    validateOrigin(request)

    // Content-Type & Size validation
    validateContentType(request)
    await validateJsonSize(request, 64 * 1024) // 64KB limit for filter payloads

    // Rate limit: 10 creations per minute per IP
    const ip = getClientIp(request)
    if (!await checkRateLimit(`filters-create:${ip}`, 10, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED)
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)
    }

    let body
    try {
      body = await request.clone().json()
    } catch {
      throw new ApiError("Invalid JSON body", 400, ErrorCodes.BAD_REQUEST)
    }

    const { name, payload, is_default } = body

    // Validate and sanitize name
    if (!name || typeof name !== 'string') {
      throw new ApiError("Filter name is required", 400, ErrorCodes.VALIDATION_ERROR)
    }
    
    const sanitizedName = sanitizeInput(name, 100).trim()
    if (sanitizedName.length < 1 || sanitizedName.length > 100) {
      throw new ApiError("Filter name must be between 1 and 100 characters", 400, ErrorCodes.VALIDATION_ERROR)
    }

    // Validate payload against FilterSchema
    const validated = FilterSchema.safeParse(payload)
    if (!validated.success) {
      throw new ApiError("Invalid filter payload", 400, ErrorCodes.VALIDATION_ERROR)
    }

    const validatedPayload = { ...validated.data }
    if (validatedPayload.q) {
      validatedPayload.q = sanitizeInput(validatedPayload.q, 200)
    }

    // Check user hasn't exceeded max saved filters (prevent abuse)
    const { count } = await supabase
      .from('saved_filters')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (count && count >= 50) {
      throw new ApiError("Maximum saved filters limit reached (50)", 400, ErrorCodes.VALIDATION_ERROR)
    }

    // If setting as default, unset previous default
    if (is_default) {
      await supabase
        .from('saved_filters')
        .update({ is_default: false })
        .eq('user_id', user.id)
    }

    const { data, error } = await supabase
      .from('saved_filters')
      .insert({
        user_id: user.id,
        name: sanitizedName,
        payload: validated.data,
        is_default: !!is_default
      })
      .select()
      .single()

    if (error) {
      console.error('[Filters POST] Database error:', error)
      throw new ApiError("Failed to save filter", 500)
    }

    // Log the event (Audit Logging enhancement)
    await logSecurityEvent({
      userId: user.id,
      event: 'FILTER_CREATE',
      status: 'success',
      ipAddress: ip,
      userAgent: request.headers.get('user-agent'),
      metadata: { filter_id: data.id, name: sanitizedName }
    })

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}
