import {
  JOB_PRIORITIES,
  QUEUE_THRESHOLDS,
  getSystemStatus,
  isPriorityAllowedAtStatus,
  assignJobPriority,
  type PriorityMetadata,
} from '../../lib/job-config';

describe('Cost-Safe Job Scheduling', () => {
  describe('getSystemStatus', () => {
    it('returns healthy for low queue depth (up to ELEVATED threshold)', () => {
      expect(getSystemStatus(0)).toBe('healthy');
      expect(getSystemStatus(2500)).toBe('healthy');
      expect(getSystemStatus(5000)).toBe('healthy'); // at ELEVATED threshold = still healthy
    });

    it('returns elevated when above ELEVATED threshold', () => {
      expect(getSystemStatus(5001)).toBe('elevated');
      expect(getSystemStatus(10000)).toBe('elevated'); // at OVERLOADED threshold = still elevated
    });

    it('returns overloaded when above OVERLOADED threshold', () => {
      expect(getSystemStatus(10001)).toBe('overloaded');
      expect(getSystemStatus(15000)).toBe('overloaded'); // at CRITICAL threshold = still overloaded
    });

    it('returns critical when above CRITICAL threshold', () => {
      expect(getSystemStatus(15001)).toBe('critical');
      expect(getSystemStatus(20000)).toBe('critical'); // at MELTDOWN threshold = still critical
    });

    it('returns meltdown when above MELTDOWN threshold', () => {
      expect(getSystemStatus(20001)).toBe('meltdown');
      expect(getSystemStatus(25000)).toBe('meltdown');
    });
  });

  describe('isPriorityAllowedAtStatus', () => {
    it('allows all priorities when healthy', () => {
      expect(isPriorityAllowedAtStatus('P0', 'healthy')).toBe(true);
      expect(isPriorityAllowedAtStatus('P1', 'healthy')).toBe(true);
      expect(isPriorityAllowedAtStatus('P2', 'healthy')).toBe(true);
      expect(isPriorityAllowedAtStatus('P3', 'healthy')).toBe(true);
    });

    it('drops P3 when elevated', () => {
      expect(isPriorityAllowedAtStatus('P0', 'elevated')).toBe(true);
      expect(isPriorityAllowedAtStatus('P1', 'elevated')).toBe(true);
      expect(isPriorityAllowedAtStatus('P2', 'elevated')).toBe(true);
      expect(isPriorityAllowedAtStatus('P3', 'elevated')).toBe(false);
    });

    it('drops P2 and P3 when overloaded', () => {
      expect(isPriorityAllowedAtStatus('P0', 'overloaded')).toBe(true);
      expect(isPriorityAllowedAtStatus('P1', 'overloaded')).toBe(true);
      expect(isPriorityAllowedAtStatus('P2', 'overloaded')).toBe(false);
      expect(isPriorityAllowedAtStatus('P3', 'overloaded')).toBe(false);
    });

    it('only allows P0 when critical', () => {
      expect(isPriorityAllowedAtStatus('P0', 'critical')).toBe(true);
      expect(isPriorityAllowedAtStatus('P1', 'critical')).toBe(false);
      expect(isPriorityAllowedAtStatus('P2', 'critical')).toBe(false);
      expect(isPriorityAllowedAtStatus('P3', 'critical')).toBe(false);
    });

    it('halts all when meltdown', () => {
      expect(isPriorityAllowedAtStatus('P0', 'meltdown')).toBe(false);
      expect(isPriorityAllowedAtStatus('P1', 'meltdown')).toBe(false);
      expect(isPriorityAllowedAtStatus('P2', 'meltdown')).toBe(false);
      expect(isPriorityAllowedAtStatus('P3', 'meltdown')).toBe(false);
    });
  });

  describe('assignJobPriority', () => {
    const baseMetadata: PriorityMetadata = {
      trackerCount: 0,
      lastActivity: null,
      isDiscovery: false,
    };

    it('assigns P0 for USER_REQUEST reason', () => {
      expect(assignJobPriority('C', 'USER_REQUEST', baseMetadata)).toBe('P0');
    });

    it('assigns P0 for GAP_RECOVERY reason', () => {
      expect(assignJobPriority('C', 'GAP_RECOVERY', baseMetadata)).toBe('P0');
    });

    it('assigns P0 for tracked series (trackerCount > 0)', () => {
      expect(assignJobPriority('C', 'PERIODIC', { ...baseMetadata, trackerCount: 1 })).toBe('P0');
    });

    it('assigns P1 for recently active series', () => {
      const recentActivity = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
      expect(assignJobPriority('C', 'PERIODIC', { ...baseMetadata, lastActivity: recentActivity })).toBe('P1');
    });

    it('assigns P1 for popular series (>= 50 trackers)', () => {
      expect(assignJobPriority('C', 'PERIODIC', { ...baseMetadata, trackerCount: 50 })).toBe('P0'); // trackerCount > 0 takes precedence
    });

    it('assigns P2 for Tier A/B series', () => {
      expect(assignJobPriority('A', 'PERIODIC', baseMetadata)).toBe('P2');
      expect(assignJobPriority('B', 'PERIODIC', baseMetadata)).toBe('P2');
    });

    it('assigns P2 for discovery jobs', () => {
      expect(assignJobPriority('C', 'PERIODIC', { ...baseMetadata, isDiscovery: true })).toBe('P2');
    });

    it('assigns P3 for cold untracked Tier C', () => {
      expect(assignJobPriority('C', 'PERIODIC', baseMetadata)).toBe('P3');
    });
  });

  describe('JOB_PRIORITIES numeric values', () => {
    it('has correct BullMQ priority values (lower = higher priority)', () => {
      expect(JOB_PRIORITIES.P0).toBe(1);
      expect(JOB_PRIORITIES.P1).toBe(2);
      expect(JOB_PRIORITIES.P2).toBe(3);
      expect(JOB_PRIORITIES.P3).toBe(4);
    });
  });

  describe('QUEUE_THRESHOLDS', () => {
    it('has correctly ordered thresholds', () => {
      expect(QUEUE_THRESHOLDS.HEALTHY).toBeLessThan(QUEUE_THRESHOLDS.ELEVATED);
      expect(QUEUE_THRESHOLDS.ELEVATED).toBeLessThan(QUEUE_THRESHOLDS.OVERLOADED);
      expect(QUEUE_THRESHOLDS.OVERLOADED).toBeLessThan(QUEUE_THRESHOLDS.CRITICAL);
      expect(QUEUE_THRESHOLDS.CRITICAL).toBeLessThan(QUEUE_THRESHOLDS.MELTDOWN);
    });
  });
});
