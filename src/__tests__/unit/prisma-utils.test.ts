/**
 * @jest-environment node
 */
import { buildSoftDeleteSafeQuery } from '@/lib/prisma';

describe('Prisma Utils - Soft Delete Safe Query Builder', () => {
  describe('buildSoftDeleteSafeQuery', () => {
    it('should add deleted_at filter to queries without WHERE clause', () => {
      const query = 'SELECT * FROM users';
      const result = buildSoftDeleteSafeQuery(query, 'users');
      
      expect(result).toContain('deleted_at IS NULL');
      expect(result).toBe('SELECT * FROM users WHERE users.deleted_at IS NULL ');
    });

    it('should add deleted_at filter to queries with existing WHERE clause', () => {
      const query = 'SELECT * FROM library_entries WHERE user_id = $1';
      const result = buildSoftDeleteSafeQuery(query, 'library_entries');
      
      expect(result).toContain('library_entries.deleted_at IS NULL');
      expect(result).toContain('AND');
    });

    it('should not modify queries that already have deleted_at filter', () => {
      const query = 'SELECT * FROM series WHERE deleted_at IS NULL AND status = $1';
      const result = buildSoftDeleteSafeQuery(query, 'series');
      
      expect(result).toBe(query);
    });

    it('should not modify queries for non-soft-delete tables', () => {
      const query = 'SELECT * FROM notifications WHERE user_id = $1';
      const result = buildSoftDeleteSafeQuery(query, 'notifications');
      
      expect(result).toBe(query);
    });

    it('should handle queries with ORDER BY correctly', () => {
      const query = 'SELECT * FROM chapters ORDER BY chapter_number DESC';
      const result = buildSoftDeleteSafeQuery(query, 'chapters');
      
      expect(result).toContain('WHERE chapters.deleted_at IS NULL');
      expect(result).toContain('ORDER BY chapter_number DESC');
      expect(result.indexOf('deleted_at')).toBeLessThan(result.indexOf('ORDER BY'));
    });

    it('should handle queries with LIMIT correctly', () => {
      const query = 'SELECT * FROM users LIMIT 10';
      const result = buildSoftDeleteSafeQuery(query, 'users');
      
      expect(result).toContain('WHERE users.deleted_at IS NULL');
      expect(result).toContain('LIMIT 10');
      expect(result.indexOf('deleted_at')).toBeLessThan(result.indexOf('LIMIT'));
    });

    it('should handle queries with GROUP BY correctly', () => {
      const query = 'SELECT status, COUNT(*) FROM library_entries GROUP BY status';
      const result = buildSoftDeleteSafeQuery(query, 'library_entries');
      
      expect(result).toContain('WHERE library_entries.deleted_at IS NULL');
      expect(result).toContain('GROUP BY status');
      expect(result.indexOf('deleted_at')).toBeLessThan(result.indexOf('GROUP BY'));
    });

    it('should handle complex WHERE clauses', () => {
      const query = 'SELECT * FROM series WHERE status = $1 AND type = $2 ORDER BY title';
      const result = buildSoftDeleteSafeQuery(query, 'series');
      
      expect(result).toContain('series.deleted_at IS NULL AND');
      expect(result).toContain('status = $1');
      expect(result).toContain('type = $2');
    });

    it('should handle case-insensitive table name matching', () => {
      const query = 'SELECT * FROM Series WHERE id = $1';
      const result = buildSoftDeleteSafeQuery(query, 'SERIES');
      
      expect(result).toContain('deleted_at IS NULL');
    });
  });
});
