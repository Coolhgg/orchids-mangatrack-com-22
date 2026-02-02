import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { 
  dlqAlerting, 
  registerDLQAlertHandler, 
  checkDLQHealth,
  type DLQAlert 
} from '@/lib/monitoring';

describe('DLQ Monitoring & Alerting', () => {
  let alerts: DLQAlert[] = [];
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    alerts = [];
    unregister = registerDLQAlertHandler((alert) => {
      alerts.push(alert);
    });
  });

  afterEach(() => {
    if (unregister) {
      unregister();
      unregister = null;
    }
  });

  describe('Alert Threshold Checks', () => {
    it('should not alert when DLQ count is below warning threshold', async () => {
      await checkDLQHealth(10);
      expect(alerts.length).toBe(0);
    });

    it('should alert with warning severity at warning threshold (50)', async () => {
      await checkDLQHealth(50);
      expect(alerts.length).toBe(1);
      expect(alerts[0].severity).toBe('warning');
      expect(alerts[0].type).toBe('dlq_threshold');
      expect(alerts[0].failureCount).toBe(50);
    });

    it('should alert with error severity at error threshold (200)', async () => {
      await checkDLQHealth(200);
      expect(alerts.length).toBe(1);
      expect(alerts[0].severity).toBe('error');
      expect(alerts[0].type).toBe('dlq_threshold');
    });

    it('should alert with critical severity at critical threshold (500)', async () => {
      await checkDLQHealth(500);
      expect(alerts.length).toBe(1);
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[0].type).toBe('dlq_critical');
    });

    it('should include correct message with failure count', async () => {
      await checkDLQHealth(750);
      expect(alerts[0].message).toContain('750');
      expect(alerts[0].message).toContain('CRITICAL');
    });
  });

  describe('Alert Handler Registration', () => {
    it('should support multiple handlers', async () => {
      const secondAlerts: DLQAlert[] = [];
      const unregister2 = registerDLQAlertHandler((alert) => {
        secondAlerts.push(alert);
      });

      await checkDLQHealth(100);

      expect(alerts.length).toBe(1);
      expect(secondAlerts.length).toBe(1);

      unregister2();
    });

    it('should stop receiving alerts after unregistering', async () => {
      if (unregister) {
        unregister();
        unregister = null;
      }

      await checkDLQHealth(100);
      expect(alerts.length).toBe(0);
    });

    it('should handle handler errors gracefully', async () => {
      const errorHandler = registerDLQAlertHandler(() => {
        throw new Error('Handler failed');
      });

      await expect(checkDLQHealth(100)).resolves.not.toThrow();

      errorHandler();
    });
  });

  describe('Alert Cooldown', () => {
    it('should not send duplicate alerts within cooldown period', async () => {
      await checkDLQHealth(100);
      await checkDLQHealth(100);
      await checkDLQHealth(100);

      expect(alerts.length).toBe(1);
    });
  });

  describe('Alert Content', () => {
    it('should include timestamp in alerts', async () => {
      const before = new Date();
      await checkDLQHealth(100);
      const after = new Date();

      expect(alerts[0].timestamp).toBeInstanceOf(Date);
      expect(alerts[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(alerts[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});

describe('DLQ Health Check Integration', () => {
  describe('Custom Thresholds', () => {
    it('should support custom thresholds', async () => {
      const alerts: DLQAlert[] = [];
      const unregister = registerDLQAlertHandler((alert) => {
        alerts.push(alert);
      });

      await dlqAlerting.checkDLQThresholds(25, { warning: 20, error: 50, critical: 100 });

      expect(alerts.length).toBe(1);
      expect(alerts[0].severity).toBe('warning');

      unregister();
    });
  });
});
