/**
 * MangaUpdates Client Unit Tests
 * Tests: pollLatestReleases, fetchSeriesMetadata, rate limiting, retries
 */

jest.mock('p-queue', () => {
  return {
    __esModule: true,
    default: class MockPQueue {
      size = 0;
      isPaused = false;
      add<T>(fn: () => Promise<T>): Promise<T> {
        return fn();
      }
      pause() { this.isPaused = true; }
      start() { this.isPaused = false; }
      clear() { this.size = 0; }
      onIdle() { return Promise.resolve(); }
    },
  };
});

import axios from 'axios';
import { MangaUpdatesClient, RateLimitError, NotFoundError } from '@/lib/mangaupdates/client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MangaUpdatesClient', () => {
  let client: MangaUpdatesClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      defaults: { timeout: 20000 },
      interceptors: { request: { use: jest.fn() } },
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    client = new MangaUpdatesClient({ requestsPerSecond: 10, maxRetries: 2 });
  });

  describe('pollLatestReleases', () => {
    it('returns flattened releases from nested API response', async () => {
      const mockResponse = {
        data: {
          total_hits: 1,
          page: 1,
          per_page: 50,
          results: [{
            record: {
              id: 12345,
              title: 'Test Manga',
              volume: '1',
              chapter: '10',
              groups: [{ name: 'TestScans', group_id: 1 }],
              release_date: new Date().toISOString(),
            },
            metadata: {
              series: { series_id: 99999, title: 'Test Manga', url: 'https://mangaupdates.com/series/99999' },
              user_list: { list_type: null, list_icon: null, status: { volume: null, chapter: null } },
              user_genre_highlights: [],
              user_genre_filters: [],
              user_group_filters: [],
              type_filter: null,
            },
          }],
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      const releases = await client.pollLatestReleases({ days: 7, page: 1 });

      expect(releases).toHaveLength(1);
      expect(releases[0]).toMatchObject({
        id: 12345,
        title: 'Test Manga',
        chapter: '10',
        series: { series_id: 99999 },
      });
    });

    it('filters releases older than specified days', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      const mockResponse = {
        data: {
          results: [{
            record: { id: 1, title: 'Old', release_date: oldDate.toISOString(), groups: [], volume: null, chapter: null },
            metadata: { series: { series_id: 1, title: 'Old', url: '' }, user_list: {}, user_genre_highlights: [], user_genre_filters: [], user_group_filters: [], type_filter: null },
          }],
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      const releases = await client.pollLatestReleases({ days: 7 });
      expect(releases).toHaveLength(0);
    });
  });

  describe('fetchSeriesMetadata', () => {
    it('returns series data on 200 response', async () => {
      const mockSeries = {
        series_id: 12345,
        title: 'One Piece',
        url: 'https://mangaupdates.com/series/12345',
        description: 'Pirates',
        genres: [{ genre: 'Action' }],
        bayesian_rating: 9.1,
        status: 'Ongoing',
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: mockSeries });

      const result = await client.fetchSeriesMetadata(12345);

      expect(result.series_id).toBe(12345);
      expect(result.title).toBe('One Piece');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/series/12345');
    });

    it('throws RateLimitError on 429 with Retry-After header', async () => {
      jest.useFakeTimers();
      const error429 = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: { 'retry-after': '1' },
          data: { reason: 'Rate limit exceeded' },
        },
        config: { url: '/series/12345' },
      };

      mockAxiosInstance.get.mockRejectedValue(error429);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      const promise = client.fetchSeriesMetadata(12345);

      for (let i = 0; i < 3; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(2000);
      }

      await expect(promise).rejects.toThrow(RateLimitError);
      jest.useRealTimers();
    });

    it('throws NotFoundError on 404', async () => {
      const error404 = {
        isAxiosError: true,
        response: { status: 404, data: { reason: 'Series not found' } },
        config: { url: '/series/99999' },
      };

      mockAxiosInstance.get.mockRejectedValue(error404);
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(client.fetchSeriesMetadata(99999)).rejects.toThrow(NotFoundError);
    });

    it('retries on 5xx with exponential backoff', async () => {
      jest.useFakeTimers();
      const error500 = {
        isAxiosError: true,
        response: { status: 500, data: {} },
        config: { url: '/series/12345' },
      };

      const mockSeries = { series_id: 12345, title: 'Test' };

      mockAxiosInstance.get
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce({ data: mockSeries });

      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      const promise = client.fetchSeriesMetadata(12345);

      await Promise.resolve();
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      const result = await promise;
      expect(result.series_id).toBe(12345);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });

  describe('rate limiting', () => {
    it('getRateLimitStatus returns queue info', () => {
      const status = client.getRateLimitStatus();
      expect(status).toHaveProperty('requestsPerSecond');
      expect(status).toHaveProperty('queueSize');
      expect(status).toHaveProperty('isPaused');
    });

    it('pauseQueue and resumeQueue control queue state', () => {
      client.pauseQueue();
      expect(client.getRateLimitStatus().isPaused).toBe(true);

      client.resumeQueue();
      expect(client.getRateLimitStatus().isPaused).toBe(false);
    });
  });
});
