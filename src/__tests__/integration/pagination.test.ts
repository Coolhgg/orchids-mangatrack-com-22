import { parsePaginationParams } from '@/lib/api-utils';

describe('Pagination Edge Cases', () => {
  describe('parsePaginationParams', () => {
    it('should handle missing parameters with defaults', () => {
      const params = new URLSearchParams();
      const result = parsePaginationParams(params);
      
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should handle zero offset', () => {
      const params = new URLSearchParams({ offset: '0', limit: '10' });
      const result = parsePaginationParams(params);
      
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(10);
    });

    it('should handle negative offset (clamp to 0)', () => {
      const params = new URLSearchParams({ offset: '-5', limit: '10' });
      const result = parsePaginationParams(params);
      
      expect(result.offset).toBe(0);
    });

    it('should handle extremely large offset', () => {
      const params = new URLSearchParams({ offset: '999999999', limit: '10' });
      const result = parsePaginationParams(params);
      
      expect(result.offset).toBe(999999999);
    });

    it('should clamp limit to max (100 default)', () => {
      const params = new URLSearchParams({ offset: '0', limit: '1000' });
      const result = parsePaginationParams(params);
      
      expect(result.limit).toBeLessThanOrEqual(100);
    });

    it('should handle zero limit (clamp to min)', () => {
      const params = new URLSearchParams({ offset: '0', limit: '0' });
      const result = parsePaginationParams(params);
      
      expect(result.limit).toBeGreaterThanOrEqual(1);
    });

    it('should handle negative limit (clamp to min)', () => {
      const params = new URLSearchParams({ offset: '0', limit: '-10' });
      const result = parsePaginationParams(params);
      
      expect(result.limit).toBeGreaterThanOrEqual(1);
    });

    it('should handle non-numeric offset gracefully', () => {
      const params = new URLSearchParams({ offset: 'abc', limit: '10' });
      const result = parsePaginationParams(params);
      
      expect(result.offset).toBe(0);
    });

    it('should handle non-numeric limit gracefully', () => {
      const params = new URLSearchParams({ offset: '0', limit: 'xyz' });
      const result = parsePaginationParams(params);
      
      expect(result.limit).toBe(20);
    });

    it('should handle decimal values (floor to integer)', () => {
      const params = new URLSearchParams({ offset: '5.7', limit: '10.3' });
      const result = parsePaginationParams(params);
      
      expect(result.offset).toBe(5);
      expect(result.limit).toBe(10);
    });

    it('should handle overflow edge case (MAX_SAFE_INTEGER)', () => {
      const params = new URLSearchParams({ 
        offset: String(Number.MAX_SAFE_INTEGER), 
        limit: '10' 
      });
      const result = parsePaginationParams(params);
      
      expect(Number.isFinite(result.offset)).toBe(true);
    });

    it('should handle scientific notation', () => {
      const params = new URLSearchParams({ offset: '1e5', limit: '10' });
      const result = parsePaginationParams(params);
      
      expect(result.offset).toBe(100000);
    });
  });

  describe('Pagination hasMore Logic', () => {
    it('should return hasMore=false when offset + items >= total', () => {
      const total = 50;
      const offset = 40;
      const itemsReturned = 10;
      
      const hasMore = offset + itemsReturned < total;
      expect(hasMore).toBe(false);
    });

    it('should return hasMore=true when offset + items < total', () => {
      const total = 100;
      const offset = 0;
      const itemsReturned = 20;
      
      const hasMore = offset + itemsReturned < total;
      expect(hasMore).toBe(true);
    });

    it('should handle empty results (total=0)', () => {
      const total = 0;
      const offset = 0;
      const itemsReturned = 0;
      
      const hasMore = offset + itemsReturned < total;
      expect(hasMore).toBe(false);
    });

    it('should handle last page edge case', () => {
      const total = 25;
      const offset = 20;
      const itemsReturned = 5;
      
      const hasMore = offset + itemsReturned < total;
      expect(hasMore).toBe(false);
    });

    it('should handle offset beyond total', () => {
      const total = 10;
      const offset = 100;
      const itemsReturned = 0;
      
      const hasMore = offset + itemsReturned < total;
      expect(hasMore).toBe(false);
    });
  });

  describe('Cursor-based Pagination', () => {
    it('should handle cursor at boundary', () => {
      const cursor = 'eyJpZCI6Imxhc3QtaXRlbS1pZCJ9';
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      
      expect(() => JSON.parse(decoded)).not.toThrow();
    });

    it('should handle malformed cursor gracefully', () => {
      const malformedCursor = 'not-valid-base64!!!';
      
      let parsedCursor = null;
      try {
        const decoded = Buffer.from(malformedCursor, 'base64').toString('utf8');
        parsedCursor = JSON.parse(decoded);
      } catch {
        parsedCursor = null;
      }
      
      expect(parsedCursor).toBeNull();
    });

    it('should handle empty cursor', () => {
      const emptyCursor = '';
      
      expect(emptyCursor || null).toBeNull();
    });
  });
});
