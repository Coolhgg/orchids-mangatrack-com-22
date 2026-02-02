import { createClient } from "@/lib/supabase/server"
import { prisma, DEFAULT_TX_OPTIONS } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { checkRateLimit, handleApiError, ApiError, ErrorCodes, getClientIp, validateOrigin, validateContentType, validateJsonSize } from "@/lib/api-utils"
import { sanitizePrismaObject } from "@/lib/utils"

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!await checkRateLimit(`source-priorities-get:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    const priorities = await prisma.userSourcePriority.findMany({
      where: { user_id: user.id },
      orderBy: { priority: "asc" },
    })

    return NextResponse.json({ priorities: sanitizePrismaObject(priorities) })
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    // CSRF Protection
    validateOrigin(request);

    // Rate limit: 20 updates per minute per IP
    const ip = getClientIp(request);
    if (!await checkRateLimit(`source-priorities-post:${ip}`, 20, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    // BUG 58: Validate Content-Type
    validateContentType(request);

    // BUG 57: Validate JSON Size
    await validateJsonSize(request);

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    const { sourcePriorities } = await request.json()

    if (!Array.isArray(sourcePriorities)) {
      throw new ApiError("Invalid payload. Expected sourcePriorities array.", 400, ErrorCodes.INVALID_INPUT);
    }

    // Validation & Sanitization
    if (sourcePriorities.length > 50) {
      throw new ApiError("Too many sources. Limit is 50.", 400, ErrorCodes.INVALID_INPUT);
    }

    const sanitizedPriorities = sourcePriorities
      .filter(s => typeof s === 'string' && s.length > 0 && s.length < 50)
      .map(s => s.trim().toLowerCase())

    // Use a transaction to update all priorities
    await prisma.$transaction(async (tx) => {
      // Delete existing priorities
      await tx.userSourcePriority.deleteMany({
        where: { user_id: user.id },
      })

      // Create new priorities
      if (sanitizedPriorities.length > 0) {
        await tx.userSourcePriority.createMany({
          data: sanitizedPriorities.map((sourceName: string, index: number) => ({
            user_id: user.id,
            source_name: sourceName,
            priority: index,
          })),
        })
      }
    }, DEFAULT_TX_OPTIONS)

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error);
  }
}

