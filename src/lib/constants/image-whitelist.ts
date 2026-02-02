export const IMAGE_WHITELIST: string[] = [
  'cdn.mangadex.org',
  'uploads.mangadex.org',
  'mangadex.org',
  'cdn.mangaupdates.com',
  'www.mangaupdates.com',
  'cdn.myanimelist.net',
  's4.anilist.co',
  'img.anili.st',
  'media.kitsu.io',
  'i.imgur.com',
  'imgur.com',
  'webtoon-phinf.pstatic.net',
  'swebtoon-phinf.pstatic.net',
  'us-a.tapas.io',
  'd30womf5coomej.cloudfront.net',
  'images.unsplash.com',
  // Supabase storage
    'nkrxhoamqsawixdwehaq.supabase.co',
]

export function isWhitelistedDomain(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return IMAGE_WHITELIST.some(domain => 
      hostname === domain || hostname.endsWith(`.${domain}`)
    )
  } catch {
    return false
  }
}

/**
 * SECURITY: Check if an IP address is internal/private
 * Prevents SSRF attacks by blocking requests to internal networks
 * UPDATED: Added stricter normalization and IPv6 edge case coverage.
 */
export function isInternalIP(hostname: string): boolean {
  if (!hostname) return true
  
  // Normalize hostname: trim, lowercase, and remove brackets from IPv6
  const normalizedHostname = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  
  // Block localhost and loopback variations
  if (
    normalizedHostname === 'localhost' || 
    normalizedHostname === '127.0.0.1' || 
    normalizedHostname === '::1' ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '::' || // Unspecified
    normalizedHostname === '0:0:0:0:0:0:0:0'
  ) {
    return true
  }

  // SECURITY: Block IPv6 mapped IPv4 addresses (::ffff:127.0.0.1, etc.)
  const ipv6MappedPattern = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i
  const ipv6MappedMatch = normalizedHostname.match(ipv6MappedPattern)
  if (ipv6MappedMatch) {
    return isInternalIP(ipv6MappedMatch[1])
  }

  // Block private IPv4 ranges
  const privateIPv4Patterns = [
    /^10\./,                    // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./,              // 192.168.0.0/16
    /^169\.254\./,              // Link-local
    /^0\./,                     // 0.0.0.0/8
    /^127\./,                   // Loopback range (127.0.0.0/8)
  ]

  for (const pattern of privateIPv4Patterns) {
    if (pattern.test(normalizedHostname)) {
      return true
    }
  }

  // Block IPv6 private/local ranges
  const ipv6PrivatePatterns = [
    /^fe80:/i,   // Link-local
    /^fc00:/i,   // Unique local (ULA)
    /^fd[0-9a-f]{2}:/i, // Unique local (ULA)
    /^ff[0-9a-f]{2}:/i, // Multicast
  ]
  
  for (const pattern of ipv6PrivatePatterns) {
    if (pattern.test(normalizedHostname)) {
      return true
    }
  }

  // Block common internal hostnames
  const internalHostnames = [
    'internal',
    'intranet',
    'private',
    'local',
    'corp',
    'admin',
    'metadata',  // AWS metadata service
  ]

  for (const internal of internalHostnames) {
    if (normalizedHostname.includes(internal)) {
      return true
    }
  }

  // Block AWS/cloud metadata service IPs
  const cloudMetadataIPs = [
    '169.254.169.254',  // AWS, GCP, Azure metadata
    '169.254.170.2',    // AWS ECS task metadata
    'fd00:ec2::254',    // AWS IPv6 metadata
  ]
  
  if (cloudMetadataIPs.includes(normalizedHostname)) {
    return true
  }

  return false
}

// SECURITY: SVG excluded to prevent XSS attacks (SVG can contain JavaScript)
export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/jpg', 
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024
