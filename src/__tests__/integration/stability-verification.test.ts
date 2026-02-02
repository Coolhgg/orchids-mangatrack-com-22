import { PRODUCTION_QUERIES } from '@/lib/sql/production-queries';
import pkg from '../../../package.json';

describe('Stability & Environment Verification', () => {
  it('should have React and React-DOM set to exactly 19.0.0', () => {
    expect(pkg.dependencies.react).toBe('19.0.0');
    expect(pkg.dependencies['react-dom']).toBe('19.0.0');
  });

  it('should not have any React version overrides', () => {
    expect((pkg as any).overrides?.react).toBeUndefined();
    expect((pkg as any).overrides?.['react-dom']).toBeUndefined();
  });

  it('should have core production queries using parameterized inputs', () => {
    // Check for common SQL injection patterns or non-parameterized strings
    const queries = Object.values(PRODUCTION_QUERIES);
    for (const query of queries) {
      if (typeof query === 'string') {
        // Parameterized queries in this codebase use $1, $2, etc.
        const hasParameters = /\$\d+/.test(query);
        const hasUnsafeInterpolation = /\${.*}/.test(query); // Check for JS template literal interpolation in strings
        
        expect(hasParameters || !query.includes('WHERE')).toBe(true);
        expect(hasUnsafeInterpolation).toBe(false);
      }
    }
  });

  it('should have critical security utilities available', async () => {
    const apiUtils = await import('@/lib/api-utils');
    expect(apiUtils.checkRateLimit).toBeDefined();
    expect(apiUtils.handleApiError).toBeDefined();
    expect(apiUtils.validateOrigin).toBeDefined();
  });
});
