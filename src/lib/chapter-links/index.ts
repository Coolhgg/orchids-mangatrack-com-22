/**
 * Chapter Links Feature
 * 
 * Provides utilities for managing user-submitted and auto-linked chapter URLs.
 * 
 * Key features:
 * - URL normalization and deduplication via SHA256 hash
 * - Advisory lock pattern for race-condition-safe 3-link limit
 * - Reputation-weighted reporting
 * - Domain blacklist checking
 */

export * from './url-utils';
export * from './constants';
export * from './types';
