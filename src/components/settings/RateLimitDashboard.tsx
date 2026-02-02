'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, Shield, Users, Activity } from 'lucide-react';

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

export function RateLimitDashboard() {
  const [stats, setStats] = useState<RateLimitStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/admin/rate-limits');
      
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized - Please log in');
        }
        if (response.status === 403) {
          throw new Error('Forbidden - Admin access required');
        }
        throw new Error('Failed to fetch rate limit stats');
      }
      
      const data = await response.json();
      setStats(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Error Loading Rate Limit Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{error}</p>
          <Button onClick={fetchStats} className="mt-4" variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Rate Limit Analytics</h2>
          <p className="text-muted-foreground">
            {lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </p>
        </div>
        <Button onClick={fetchStats} disabled={loading} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-500" />
              Tracked Keys
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : stats?.summary.total_tracked_keys || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Active rate limit counters in Redis
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-yellow-500" />
              Active Limits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : stats?.summary.active_rate_limits || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Users currently being rate limited
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Violations (1h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '...' : stats?.summary.violations_last_hour || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Anti-abuse violations detected
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Endpoint Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Top Endpoints by Traffic</CardTitle>
          <CardDescription>
            Most requested API endpoints in the last hour
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted rounded" />
              ))}
            </div>
          ) : stats?.endpoints.length === 0 ? (
            <p className="text-muted-foreground">No endpoint data available</p>
          ) : (
            <div className="space-y-2">
              {stats?.endpoints.map((endpoint) => (
                <div
                  key={endpoint.endpoint}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <code className="text-sm font-mono">{endpoint.endpoint}</code>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">
                      {endpoint.requests_last_hour} req/h
                    </span>
                    {endpoint.rate_limited_count > 0 && (
                      <Badge variant="destructive">
                        {endpoint.rate_limited_count} limited
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Users */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Top Users by Request Volume
          </CardTitle>
          <CardDescription>
            Users with highest request counts (anonymized)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted rounded" />
              ))}
            </div>
          ) : stats?.top_users.length === 0 ? (
            <p className="text-muted-foreground">No user data available</p>
          ) : (
            <div className="space-y-2">
              {stats?.top_users.map((user, i) => (
                <div
                  key={user.user_id}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">#{i + 1}</span>
                    <code className="text-sm font-mono">{user.user_id}</code>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">
                      {user.requests_last_hour} requests
                    </span>
                    {user.rate_limited ? (
                      <Badge variant="destructive">Rate Limited</Badge>
                    ) : (
                      <Badge variant="secondary">Normal</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Violations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Violation Types
          </CardTitle>
          <CardDescription>
            Breakdown of anti-abuse violations detected
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-10 bg-muted rounded" />
              ))}
            </div>
          ) : stats?.violations.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No violations detected - System healthy
            </p>
          ) : (
            <div className="space-y-2">
              {stats?.violations.map((violation) => (
                <div
                  key={violation.type}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <code className="text-sm font-mono">{violation.type}</code>
                  <div className="flex items-center gap-4">
                    <Badge variant={violation.count > 10 ? 'destructive' : 'secondary'}>
                      {violation.count} occurrences
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default RateLimitDashboard;
