import { shouldNotifyChapter, shouldThrottleUser } from '@/lib/notifications-throttling';

jest.mock('@/lib/redis', () => ({
  redis: {
    set: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
  },
  REDIS_KEY_PREFIX: 'test:',
  isRedisConnected: jest.fn(),
}));

import { redis, isRedisConnected } from '@/lib/redis';

const mockIsRedisConnected = isRedisConnected as jest.Mock;
const mockRedisSet = redis.set as jest.Mock;
const mockRedisIncr = redis.incr as jest.Mock;
const mockRedisExpire = redis.expire as jest.Mock;

describe('Notification Throttling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('shouldNotifyChapter', () => {
    describe('with Redis available', () => {
      beforeEach(() => {
        mockIsRedisConnected.mockReturnValue(true);
      });

      it('should return true for first notification (Redis NX succeeds)', async () => {
        mockRedisSet.mockResolvedValue('OK');
        
        const result = await shouldNotifyChapter('series-1', 1);
        
        expect(result).toBe(true);
        expect(mockRedisSet).toHaveBeenCalledWith(
          expect.stringContaining('notify:dedupe:series-1:1'),
          '1',
          'EX',
          expect.any(Number),
          'NX'
        );
      });

      it('should return false for duplicate notification (Redis NX fails)', async () => {
        mockRedisSet.mockResolvedValue(null);
        
        const result = await shouldNotifyChapter('series-1', 1);
        
        expect(result).toBe(false);
      });

      it('should return true on Redis error (fail-open)', async () => {
        mockRedisSet.mockRejectedValue(new Error('Redis connection error'));
        
        const result = await shouldNotifyChapter('series-1', 1);
        
        expect(result).toBe(true);
      });
    });

    describe('with Redis unavailable (in-memory fallback)', () => {
      beforeEach(() => {
        mockIsRedisConnected.mockReturnValue(false);
      });

      it('should return true for first notification', async () => {
        const result = await shouldNotifyChapter('series-fallback', 1);
        
        expect(result).toBe(true);
        expect(mockRedisSet).not.toHaveBeenCalled();
      });

      it('should return false for duplicate notification', async () => {
        await shouldNotifyChapter('series-dedupe-test', 99);
        const result = await shouldNotifyChapter('series-dedupe-test', 99);
        
        expect(result).toBe(false);
      });

      it('should allow different chapters for same series', async () => {
        await shouldNotifyChapter('series-multi', 1);
        const result = await shouldNotifyChapter('series-multi', 2);
        
        expect(result).toBe(true);
      });
    });
  });

  describe('shouldThrottleUser', () => {
    describe('with Redis available', () => {
      beforeEach(() => {
        mockIsRedisConnected.mockReturnValue(true);
      });

      it('should not throttle first notification', async () => {
        mockRedisSet.mockResolvedValue('OK');
        mockRedisIncr.mockResolvedValue(1);
        
        const result = await shouldThrottleUser('user-1', 'series-1');
        
        expect(result.throttle).toBe(false);
      });

      it('should throttle when manga hourly limit reached', async () => {
        mockRedisSet.mockResolvedValue(null);
        
        const result = await shouldThrottleUser('user-1', 'series-1');
        
        expect(result.throttle).toBe(true);
        expect(result.reason).toBe('manga_hourly_limit');
      });

      it('should throttle when user hourly limit exceeded', async () => {
        mockRedisSet.mockResolvedValue('OK');
        mockRedisIncr.mockResolvedValue(101);
        
        const result = await shouldThrottleUser('user-1', 'series-1');
        
        expect(result.throttle).toBe(true);
        expect(result.reason).toBe('user_hourly_limit');
      });

      it('should throttle when user daily limit exceeded', async () => {
        mockRedisSet.mockResolvedValue('OK');
        mockRedisIncr
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(51);
        
        const result = await shouldThrottleUser('user-1', 'series-1');
        
        expect(result.throttle).toBe(true);
        expect(result.reason).toBe('user_daily_limit');
      });

      it('should allow higher daily limit for premium users', async () => {
        mockRedisSet.mockResolvedValue('OK');
        mockRedisIncr
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(100);
        
        const result = await shouldThrottleUser('user-1', 'series-1', true);
        
        expect(result.throttle).toBe(false);
      });

      it('should fallback to memory on Redis error', async () => {
        mockRedisSet.mockRejectedValue(new Error('Redis error'));
        
        const result = await shouldThrottleUser('user-error-test', 'series-1');
        
        expect(result.throttle).toBe(false);
      });
    });

    describe('with Redis unavailable (in-memory fallback)', () => {
      beforeEach(() => {
        mockIsRedisConnected.mockReturnValue(false);
      });

      it('should not throttle first notification', async () => {
        const result = await shouldThrottleUser('user-memory-1', 'series-memory-1');
        
        expect(result.throttle).toBe(false);
      });

      it('should throttle same manga within hour', async () => {
        await shouldThrottleUser('user-memory-2', 'series-memory-2');
        const result = await shouldThrottleUser('user-memory-2', 'series-memory-2');
        
        expect(result.throttle).toBe(true);
        expect(result.reason).toBe('manga_hourly_limit');
      });

      it('should allow different manga for same user', async () => {
        await shouldThrottleUser('user-memory-3', 'series-a');
        const result = await shouldThrottleUser('user-memory-3', 'series-b');
        
        expect(result.throttle).toBe(false);
      });
    });
  });
});
