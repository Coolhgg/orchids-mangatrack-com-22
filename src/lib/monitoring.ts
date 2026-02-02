type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface ErrorContext {
  requestId?: string;
  userId?: string;
  path?: string;
  method?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

interface MonitoringConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  sampleRate?: number;
  enabled?: boolean;
}

class ErrorMonitoring {
  private config: MonitoringConfig = {
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    sampleRate: 1.0,
    enabled: process.env.NODE_ENV === 'production',
  };

  private isInitialized = false;
  private queue: Array<{ error: Error; context?: ErrorContext }> = [];

  async init(overrides?: Partial<MonitoringConfig>) {
    if (this.isInitialized) return;
    
    this.config = { ...this.config, ...overrides };

    if (!this.config.dsn || !this.config.enabled) {
      this.isInitialized = true;
      return;
    }

    try {
      this.isInitialized = true;
      this.processQueue();
    } catch (err) {
      console.warn('Failed to initialize error monitoring:', err);
    }
  }

  private processQueue() {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        this.captureException(item.error, item.context);
      }
    }
  }

  captureException(error: Error, context?: ErrorContext) {
    if (!this.isInitialized) {
      this.queue.push({ error, context });
      return;
    }

    if (!this.config.dsn || !this.config.enabled) {
      return;
    }

    if (this.config.sampleRate && Math.random() > this.config.sampleRate) {
      return;
    }

    console.error('[ErrorMonitoring] Captured exception:', {
      name: error.name,
      message: error.message,
      requestId: context?.requestId,
      userId: context?.userId,
      path: context?.path,
    });
  }

  captureMessage(message: string, level: LogLevel = 'info', context?: ErrorContext) {
    if (!this.config.dsn || !this.config.enabled) {
      return;
    }

    console.log(`[ErrorMonitoring] ${level.toUpperCase()}: ${message}`, context);
  }

  setUser(user: { id: string; email?: string; username?: string } | null) {
    if (!this.config.dsn || !this.config.enabled) {
      return;
    }
  }

  addBreadcrumb(breadcrumb: {
    category?: string;
    message: string;
    level?: LogLevel;
    data?: Record<string, unknown>;
  }) {
    if (!this.config.dsn || !this.config.enabled) {
      return;
    }
  }

  withScope<T>(callback: (scope: ErrorContext) => T): T {
    const scope: ErrorContext = {};
    return callback(scope);
  }

  async flush(timeout?: number): Promise<boolean> {
    return true;
  }
}

export const errorMonitoring = new ErrorMonitoring();

export function captureException(error: Error, context?: ErrorContext) {
  errorMonitoring.captureException(error, context);
}

export function captureMessage(message: string, level?: LogLevel, context?: ErrorContext) {
  errorMonitoring.captureMessage(message, level, context);
}

export function setUser(user: { id: string; email?: string; username?: string } | null) {
  errorMonitoring.setUser(user);
}

export function addBreadcrumb(breadcrumb: {
  category?: string;
  message: string;
  level?: LogLevel;
  data?: Record<string, unknown>;
}) {
  errorMonitoring.addBreadcrumb(breadcrumb);
}

export async function initMonitoring(config?: Partial<MonitoringConfig>) {
  await errorMonitoring.init(config);
}

// =============================================================================
// DLQ MONITORING & ALERTING
// =============================================================================

export interface DLQAlert {
  type: 'dlq_threshold' | 'dlq_critical' | 'metadata_failure' | 'source_failure' | 'system_error';
  entityId?: string;
  failureCount: number;
  message: string;
  timestamp: Date;
  severity: 'warning' | 'error' | 'critical';
}

export type AlertHandler = (alert: DLQAlert) => void | Promise<void>;

class DLQAlertingService {
  private handlers: AlertHandler[] = [];
  private lastAlertTime = new Map<string, number>();
  private readonly alertCooldownMs = 5 * 60 * 1000; // 5 minutes between same alerts

  registerHandler(handler: AlertHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index > -1) this.handlers.splice(index, 1);
    };
  }

  async sendAlert(alert: DLQAlert): Promise<void> {
    const alertKey = `${alert.type}:${alert.entityId || 'global'}`;
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(alertKey);

    if (lastAlert && now - lastAlert < this.alertCooldownMs) {
      return;
    }

    this.lastAlertTime.set(alertKey, now);

    console.error(`[DLQ_ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`, {
      type: alert.type,
      entityId: alert.entityId,
      failureCount: alert.failureCount,
      timestamp: alert.timestamp.toISOString(),
    });

    for (const handler of this.handlers) {
      try {
        await handler(alert);
      } catch (err) {
        console.error('[DLQ_ALERT] Handler error:', err);
      }
    }

    errorMonitoring.captureMessage(alert.message, alert.severity === 'critical' ? 'error' : 'warn', {
      tags: { alertType: alert.type, severity: alert.severity },
      extra: { failureCount: alert.failureCount, entityId: alert.entityId },
    });
  }

  async checkDLQThresholds(dlqCount: number, thresholds = { warning: 50, error: 200, critical: 500 }): Promise<void> {
    if (dlqCount >= thresholds.critical) {
      await this.sendAlert({
        type: 'dlq_critical',
        failureCount: dlqCount,
        message: `CRITICAL: DLQ has ${dlqCount} unresolved failures (threshold: ${thresholds.critical})`,
        timestamp: new Date(),
        severity: 'critical',
      });
    } else if (dlqCount >= thresholds.error) {
      await this.sendAlert({
        type: 'dlq_threshold',
        failureCount: dlqCount,
        message: `ERROR: DLQ has ${dlqCount} unresolved failures (threshold: ${thresholds.error})`,
        timestamp: new Date(),
        severity: 'error',
      });
    } else if (dlqCount >= thresholds.warning) {
      await this.sendAlert({
        type: 'dlq_threshold',
        failureCount: dlqCount,
        message: `WARNING: DLQ has ${dlqCount} unresolved failures (threshold: ${thresholds.warning})`,
        timestamp: new Date(),
        severity: 'warning',
      });
    }
  }
}

export const dlqAlerting = new DLQAlertingService();

export function registerDLQAlertHandler(handler: AlertHandler): () => void {
  return dlqAlerting.registerHandler(handler);
}

export async function checkDLQHealth(dlqCount: number): Promise<void> {
  return dlqAlerting.checkDLQThresholds(dlqCount);
}
