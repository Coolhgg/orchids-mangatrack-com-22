import { NextRequest, NextResponse } from "next/server"
import { isWhitelistedDomain, isInternalIP } from "@/lib/constants/image-whitelist"
import { checkRateLimit, ApiError, ErrorCodes, handleApiError, getClientIp } from "@/lib/api-utils"
import { initDNS } from "@/lib/dns-init"
import dns from "node:dns/promises"

// Initialize DNS servers (Google DNS fallback)
initDNS();

export async function GET(req: NextRequest) {
  try {
    // Rate limit: 100 requests per minute per IP
    const ip = getClientIp(req);
    if (!await checkRateLimit(`check-url:${ip}`, 100, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED)
    }

    const { searchParams } = new URL(req.url)
    const url = searchParams.get("url")

    if (!url) {
      throw new ApiError('Missing url parameter', 400, ErrorCodes.BAD_REQUEST)
    }

    let decodedUrl: string
    try {
      decodedUrl = decodeURIComponent(url)
    } catch {
      throw new ApiError('Invalid URL encoding', 400, ErrorCodes.BAD_REQUEST)
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(decodedUrl)
    } catch {
      throw new ApiError('Invalid URL format', 400, ErrorCodes.BAD_REQUEST)
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new ApiError('Invalid protocol. Only HTTP/HTTPS allowed', 400, ErrorCodes.BAD_REQUEST)
    }

    // SSRF DEFENSE PHASE 1: Static hostname check
    if (isInternalIP(parsedUrl.hostname)) {
      throw new ApiError('Internal addresses are not allowed', 403, ErrorCodes.FORBIDDEN)
    }

    // For checking source availability, we don't necessarily want strict whitelist
    // but we MUST prevent internal network access.
    // If the project has a source whitelist, we should use it here.
    // However, since this is for "checking availability" of arbitrary sources,
    // we will stick to DNS and Internal IP checks unless a whitelist is specifically required.

    // SSRF DEFENSE PHASE 2: DNS Resolution check
    try {
      const lookup = await dns.lookup(parsedUrl.hostname)
      if (lookup.address && isInternalIP(lookup.address)) {
        throw new ApiError('Destination resolves to an internal address', 403, ErrorCodes.FORBIDDEN)
      }
    } catch (dnsErr) {
      console.warn(`[CheckUrl] DNS lookup failed for ${parsedUrl.hostname}:`, dnsErr)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3500) // 3.5s timeout

    const response = await fetch(decodedUrl, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    }).catch(err => {
       if (err.name === 'AbortError') throw err;
       return null;
    })

    clearTimeout(timeoutId)

    // A source is considered "working" if it's not a 4xx or 5xx error
    // Note: Some sites might block HEAD requests with 403/405, but we'll treat them as failed for now
    // or we can fallback to GET if HEAD fails with 405.
    
    if (!response || response.status === 405 || response.status === 403) {
      // Try GET with a small range if HEAD is blocked
      const getController = new AbortController()
      const getTimeoutId = setTimeout(() => getController.abort(), 3500)
      
      const getResponse = await fetch(decodedUrl, {
        method: "GET",
        signal: getController.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Range": "bytes=0-0", // Just first byte
        },
        cache: "no-store",
      }).catch(() => null)
      
      clearTimeout(getTimeoutId)
      
      if (!getResponse) {
        return NextResponse.json({ ok: false, status: 502 })
      }

      return NextResponse.json({
        ok: getResponse.status < 400,
        status: getResponse.status,
      })
    }

    return NextResponse.json({
      ok: response.status < 400,
      status: response.status,
    })
  } catch (error: any) {
    if (error instanceof ApiError) return handleApiError(error)
    return handleApiError(new ApiError(error.message || "Fetch failed", 500, ErrorCodes.INTERNAL_ERROR))
  }
}
