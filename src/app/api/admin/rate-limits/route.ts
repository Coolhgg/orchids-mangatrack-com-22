import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { redis } from '@/lib/redis';
import { REDIS_KEY_PREFIX } from '@/lib/redis';

/**
 * Rate Limit Analytics API
 * 
 * GET /api/admin/rate-limits
 * 
 * Returns rate limiting statistics for monitoring and analytics.
 * Requires admin authentication.
 */

// Admin user IDs (in production, use a proper admin check)
const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS?.split(',') || [];

interface RateLimitStats {
  timestamp: string;
  summary: {
    total_tracked_keys: number;
    active_rate_limits: number;
    violations_last_hour: number;
  };
  endpoints: {
    endpoint: string;
    requests_last_minute: number;
    requests_last_hour: number;
    rate_limited_count: number;
  }[];
  top_users: {
    user_id: string;
    requests_last_hour: number;
    rate_limited: boolean;
  }[];
  violations: {
    type: string;
    count: number;
    last_occurrence: string;
  }[];
}

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check if user is admin
    const isAdmin = ADMIN_USER_IDS.includes(user.id) || 
                    user.email?.endsWith('@mangatrack.com') ||
                    process.env.NODE_ENV === 'development';
    
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Gather rate limit statistics
    const stats = await gatherRateLimitStats();
    
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Rate limit analytics error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function gatherRateLimitStats(): Promise<RateLimitStats> {
  const stats: RateLimitStats = {
    timestamp: new Date().toISOString(),
    summary: {
      total_tracked_keys: 0,
      active_rate_limits: 0,
      violations_last_hour: 0,
    },
    endpoints: [],
    top_users: [],
    violations: [],
  };
  
  if (!redis) {
    // Return empty stats if Redis is not available
    return stats;
  }
  
  try {
    // Get all rate limit keys
    const prefix = REDIS_KEY_PREFIX || 'mangatrack:';
    const rateLimitKeys = await redis.keys(`${prefix}ratelimit:*`);
    const violationKeys = await redis.keys(`${prefix}violation:*`);
    const antiAbuseKeys = await redis.keys(`${prefix}abuse:*`);
    
    stats.summary.total_tracked_keys = rateLimitKeys.length + violationKeys.length + antiAbuseKeys.length;
    
    // Count active rate limits (keys with values > threshold)
    for (const key of rateLimitKeys.slice(0, 100)) { // Limit to 100 for performance
      const value = await redis.get(key);
      if (value && parseInt(value) > 0) {
        stats.summary.active_rate_limits++;
      }
    }
    
    // Count violations in last hour
    for (const key of violationKeys) {
      const value = await redis.get(key);
      if (value) {
        stats.summary.violations_last_hour += parseInt(value) || 0;
      }
    }
    
    // Gather endpoint statistics
    const endpointStats: Map<string, { requests: number; rateLimited: number }> = new Map();
    
    for (const key of rateLimitKeys.slice(0, 200)) {
      // Parse endpoint from key: mangatrack:ratelimit:endpoint:/api/xxx:user:xxx
      const parts = key.split(':');
      const endpointIndex = parts.indexOf('endpoint');
      if (endpointIndex >= 0 && parts[endpointIndex + 1]) {
        const endpoint = parts[endpointIndex + 1];
        const current = endpointStats.get(endpoint) || { requests: 0, rateLimited: 0 };
        const value = parseInt(await redis.get(key) || '0');
        current.requests += value;
        endpointStats.set(endpoint, current);
      }
    }
    
    // Convert to array and sort by requests
    stats.endpoints = Array.from(endpointStats.entries())
      .map(([endpoint, data]) => ({
        endpoint,
        requests_last_minute: Math.floor(data.requests / 60), // Approximate
        requests_last_hour: data.requests,
        rate_limited_count: data.rateLimited,
      }))
      .sort((a, b) => b.requests_last_hour - a.requests_last_hour)
      .slice(0, 10);
    
    // Get top users by request count
    const userStats: Map<string, { requests: number; rateLimited: boolean }> = new Map();
    
    for (const key of rateLimitKeys.slice(0, 200)) {
      const parts = key.split(':');
      const userIndex = parts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) {
        const userId = parts[userIndex + 1];
        const current = userStats.get(userId) || { requests: 0, rateLimited: false };
        const value = parseInt(await redis.get(key) || '0');
        current.requests += value;
        
        // Check if rate limited
        const ttl = await redis.ttl(key);
        if (ttl > 0 && value > 100) {
          current.rateLimited = true;
        }
        
        userStats.set(userId, current);
      }
    }
    
    stats.top_users = Array.from(userStats.entries())
      .map(([user_id, data]) => ({
        user_id: user_id.slice(0, 8) + '...', // Anonymize
        requests_last_hour: data.requests,
        rate_limited: data.rateLimited,
      }))
      .sort((a, b) => b.requests_last_hour - a.requests_last_hour)
      .slice(0, 10);
    
    // Get violation types
    const violationTypes: Map<string, { count: number; lastOccurrence: string }> = new Map();
    
    for (const key of violationKeys) {
      // Parse violation type from key
      const parts = key.split(':');
      const typeIndex = parts.indexOf('violation');
      if (typeIndex >= 0 && parts[typeIndex + 1]) {
        const violationType = parts[typeIndex + 1];
        const current = violationTypes.get(violationType) || { count: 0, lastOccurrence: '' };
        const value = parseInt(await redis.get(key) || '0');
        current.count += value;
        current.lastOccurrence = new Date().toISOString(); // Approximate
        violationTypes.set(violationType, current);
      }
    }
    
    stats.violations = Array.from(violationTypes.entries())
      .map(([type, data]) => ({
        type,
        count: data.count,
        last_occurrence: data.lastOccurrence,
      }))
      .sort((a, b) => b.count - a.count);
    
  } catch (redisError) {
    console.error('Redis error gathering stats:', redisError);
  }
  
  return stats;
}
