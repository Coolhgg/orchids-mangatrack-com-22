import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { withErrorHandling, ApiError, ErrorCodes } from "@/lib/api-utils"
import { getMetricsSummary } from "@/lib/metrics"

export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)
    }

    const isAdmin = user.app_metadata?.role === 'admin'
    
    if (!isAdmin) {
      throw new ApiError("Forbidden: Admin privileges required", 403, ErrorCodes.FORBIDDEN)
    }

    const metrics = await getMetricsSummary()

    return {
      timestamp: new Date().toISOString(),
      window_ms: 60000,
      metrics,
    }
  })
}
