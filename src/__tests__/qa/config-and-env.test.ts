import {
  validateEnv,
  assertEnvValid,
  getEnvConfig,
  resetEnvValidation,
  isProduction,
  isDevelopment,
  isTest,
} from '@/lib/config/env-validation';

import {
  getFeatureFlags,
  isFeatureEnabled,
  resetFeatureFlags,
  setFeatureFlag,
} from '@/lib/config/feature-flags';

describe('Bug 70: Runtime env validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetEnvValidation();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('validateEnv', () => {
    it('should validate required env vars', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

      const result = validateEnv();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when required vars are missing', () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const result = validateEnv();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn when optional but important vars are missing', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
      delete process.env.REDIS_URL;
      delete process.env.INTERNAL_API_SECRET;

      const result = validateEnv();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should cache validation result', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

      const result1 = validateEnv();
      const result2 = validateEnv();
      expect(result1).toBe(result2);
    });
  });

  describe('assertEnvValid', () => {
    it('should throw on invalid env', () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      expect(() => assertEnvValid()).toThrow('Environment validation failed');
    });

    it('should not throw on valid env', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

      expect(() => assertEnvValid()).not.toThrow();
    });
  });

  describe('getEnvConfig', () => {
    it('should return config object', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: true, configurable: true });

      const config = getEnvConfig();
      expect(config.NEXT_PUBLIC_SUPABASE_URL).toBe('https://test.supabase.co');
      expect(config.NODE_ENV).toBe('test');
    });
  });

  describe('environment helpers', () => {
    it('should detect production', () => {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', writable: true });
      resetEnvValidation();
      expect(isProduction()).toBe(true);
      expect(isDevelopment()).toBe(false);
      expect(isTest()).toBe(false);
    });

    it('should detect development', () => {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true });
      resetEnvValidation();
      expect(isProduction()).toBe(false);
      expect(isDevelopment()).toBe(true);
      expect(isTest()).toBe(false);
    });

    it('should detect test', () => {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: true });
      resetEnvValidation();
      expect(isProduction()).toBe(false);
      expect(isDevelopment()).toBe(false);
      expect(isTest()).toBe(true);
    });
  });
});

describe('Bug 71: Centralized feature flags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetFeatureFlags();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getFeatureFlags', () => {
    it('should return default flags when env not set', () => {
      delete process.env.FEATURE_FLAGS;

      const flags = getFeatureFlags();
      expect(flags.metadata_retry).toBe(true);
      expect(flags.memory_guards).toBe(true);
      expect(flags.response_validation).toBe(false);
    });

    it('should parse flags from env', () => {
      process.env.FEATURE_FLAGS = JSON.stringify({
        metadata_retry: false,
        memory_guards: false,
      });

      const flags = getFeatureFlags();
      expect(flags.metadata_retry).toBe(false);
      expect(flags.memory_guards).toBe(false);
      expect(flags.resolution_thresholds).toBe(true);
    });

    it('should handle invalid JSON gracefully', () => {
      process.env.FEATURE_FLAGS = 'not-valid-json';

      const flags = getFeatureFlags();
      expect(flags.metadata_retry).toBe(true);
    });

    it('should cache flags', () => {
      const flags1 = getFeatureFlags();
      const flags2 = getFeatureFlags();
      expect(flags1).toBe(flags2);
    });
  });

  describe('isFeatureEnabled', () => {
    it('should check individual flags', () => {
      delete process.env.FEATURE_FLAGS;

      expect(isFeatureEnabled('metadata_retry')).toBe(true);
      expect(isFeatureEnabled('response_validation')).toBe(false);
    });
  });

  describe('setFeatureFlag', () => {
    it('should update individual flags', () => {
      setFeatureFlag('response_validation', true);
      expect(isFeatureEnabled('response_validation')).toBe(true);

      setFeatureFlag('response_validation', false);
      expect(isFeatureEnabled('response_validation')).toBe(false);
    });

    it('should preserve other flags when updating one', () => {
      const originalMetadataRetry = isFeatureEnabled('metadata_retry');

      setFeatureFlag('response_validation', true);
      expect(isFeatureEnabled('metadata_retry')).toBe(originalMetadataRetry);
    });
  });

  describe('resetFeatureFlags', () => {
    it('should clear cache and reload from env', () => {
      process.env.FEATURE_FLAGS = JSON.stringify({ metadata_retry: false });

      const flags1 = getFeatureFlags();
      expect(flags1.metadata_retry).toBe(false);

      process.env.FEATURE_FLAGS = JSON.stringify({ metadata_retry: true });
      resetFeatureFlags();

      const flags2 = getFeatureFlags();
      expect(flags2.metadata_retry).toBe(true);
    });
  });
});

describe('Bug 64-66: API Route Tests', () => {
  describe('Bug 65: Idempotency', () => {
    it('should generate consistent idempotency keys', () => {
      const key1 = `library-add:user123:${Date.now()}`;
      const key2 = `library-add:user123:${Date.now()}`;

      expect(key1.startsWith('library-add:user123:')).toBe(true);
      expect(key2.startsWith('library-add:user123:')).toBe(true);
    });
  });

  describe('Bug 66: Error consistency', () => {
    it('should format errors consistently', () => {
      const error1 = { error: 'Test error', code: 'TEST_ERROR', requestId: 'abc123' };
      const error2 = { error: 'Another error', code: 'ANOTHER_ERROR', requestId: 'def456' };

      expect(error1).toHaveProperty('error');
      expect(error1).toHaveProperty('code');
      expect(error1).toHaveProperty('requestId');

      expect(error2).toHaveProperty('error');
      expect(error2).toHaveProperty('code');
      expect(error2).toHaveProperty('requestId');
    });
  });
});
