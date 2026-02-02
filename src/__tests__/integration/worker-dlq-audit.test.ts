/** @jest-environment node */
import { prisma } from '@/lib/prisma';
import { logSecurityEvent, wrapWithDLQ } from '@/lib/api-utils';
import { v4 as uuidv4 } from 'uuid';

jest.mock('@/lib/redis', () => ({
  redis: { 
    get: jest.fn().mockResolvedValue(null), 
    set: jest.fn(), 
    del: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
  },
  workerRedis: { 
    get: jest.fn().mockResolvedValue(null), 
    set: jest.fn(), 
    del: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
  },
}));

describe('Worker DLQ and Audit Logging Integration Tests', () => {
  const testUserId = uuidv4();
  const auditLogs: any[] = [];
  const workerFailures: any[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    auditLogs.length = 0;
    workerFailures.length = 0;
    
    (prisma.user.create as jest.Mock).mockResolvedValue({ 
      id: testUserId, 
      email: 'qa-audit@example.com',
      username: 'qa_auditor' 
    });
    
    (prisma.auditLog.create as jest.Mock).mockImplementation(({ data }) => {
      const log = { id: uuidv4(), ...data };
      auditLogs.push(log);
      return Promise.resolve(log);
    });
    
    (prisma.auditLog.findFirst as jest.Mock).mockImplementation(({ where }) => {
      const found = auditLogs.find(l => 
        (!where?.user_id || l.user_id === where.user_id) &&
        (!where?.event || l.event === where.event)
      );
      return Promise.resolve(found || null);
    });
    
    (prisma.workerFailure.create as jest.Mock).mockImplementation(({ data }) => {
      const failure = { id: uuidv4(), ...data };
      workerFailures.push(failure);
      return Promise.resolve(failure);
    });
    
    (prisma.workerFailure.findFirst as jest.Mock).mockImplementation(({ where }) => {
      const found = workerFailures.find(f => 
        (!where?.queue_name || f.queue_name === where.queue_name) &&
        (!where?.job_id || f.job_id === where.job_id)
      );
      return Promise.resolve(found || null);
    });
  });

  test('logSecurityEvent should create an audit log entry', async () => {
    const event = 'TEST_EVENT';
    const metadata = { foo: 'bar' };

    await logSecurityEvent({
      userId: testUserId,
      event,
      status: 'success',
      ipAddress: '127.0.0.1',
      userAgent: 'Jest',
      metadata
    });

    expect(auditLogs.length).toBeGreaterThan(0);
    const log = auditLogs.find(l => l.event === event);
    expect(log).toBeDefined();
    expect(log?.status).toBe('success');
    expect(log?.metadata).toMatchObject(metadata);
  });

  test('wrapWithDLQ should log failure on last attempt', async () => {
    const queueName = 'test-queue';
    const errorMsg = 'Persistent Failure';
    
    const failingProcessor = async () => {
      throw new Error(errorMsg);
    };

    const wrapped = wrapWithDLQ(queueName, failingProcessor);

    const mockJob = {
      id: 'test-job-dlq',
      data: { some: 'data' },
      attemptsMade: 2,
      opts: { attempts: 3 }
    };

    await expect(wrapped(mockJob)).rejects.toThrow(errorMsg);

    const failure = workerFailures.find(f => f.job_id === 'test-job-dlq');
    expect(failure).toBeDefined();
    expect(failure?.error_message).toBe(errorMsg);
    expect(failure?.attempts_made).toBe(3);
    expect(failure?.payload).toMatchObject({ some: 'data' });
  });

  test('wrapWithDLQ should NOT log failure if not last attempt', async () => {
    const queueName = 'test-queue-no-dlq';
    const errorMsg = 'Transient Failure';
    
    const failingProcessor = async () => {
      throw new Error(errorMsg);
    };

    const wrapped = wrapWithDLQ(queueName, failingProcessor);

    const mockJob = {
      id: 'test-job-no-dlq',
      data: { some: 'data' },
      attemptsMade: 0,
      opts: { attempts: 3 }
    };

    await expect(wrapped(mockJob)).rejects.toThrow(errorMsg);

    const failure = workerFailures.find(f => f.job_id === 'test-job-no-dlq');
    expect(failure).toBeUndefined();
  });
});
