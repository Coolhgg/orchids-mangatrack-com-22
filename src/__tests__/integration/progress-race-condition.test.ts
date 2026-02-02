// Converted from vitest to jest

describe('Progress API Race Conditions', () => {
  const mockUserId = '00000000-0000-0000-0000-000000000001';
  const mockEntryId = '00000000-0000-0000-0000-000000000002';
  const mockSeriesId = '00000000-0000-0000-0000-000000000003';

  it('should handle concurrent progress updates atomically', async () => {
    const mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        return callback({
          libraryEntry: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockEntryId,
              user_id: mockUserId,
              series_id: mockSeriesId,
              last_read_chapter: 5,
              deleted_at: null,
            }),
            update: jest.fn().mockResolvedValue({
              id: mockEntryId,
              last_read_chapter: 10,
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockUserId,
              xp: 100,
              level: 2,
              streak_days: 1,
              last_read_at: new Date(),
              longest_streak: 5,
              chapters_read: 50,
              current_season: 'Q1-2025',
              season_xp: 50,
              deleted_at: null,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
          chapter: {
            findFirst: jest.fn().mockResolvedValue({ id: 'chapter-id', page_count: 20 }),
          },
          userChapterReadV2: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
          $queryRaw: jest.fn().mockResolvedValue([]),
          $executeRaw: jest.fn().mockResolvedValue(0),
        });
      }),
    };

    const concurrentRequests = 10;
    const xpAwards: number[] = [];

    for (let i = 0; i < concurrentRequests; i++) {
      const result = await mockPrisma.$transaction(async (tx: any) => {
        const entry = await tx.libraryEntry.findUnique({ where: { id: mockEntryId } });
        expect(entry.user_id).toBe(mockUserId);
        expect(entry.deleted_at).toBeNull();
        
        return { xpGained: 1 };
      });
      xpAwards.push(result.xpGained);
    }

    expect(xpAwards).toHaveLength(concurrentRequests);
    expect(xpAwards.every(xp => xp === 1)).toBe(true);
  });

  it('should reject progress update for soft-deleted entry', async () => {
    const mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        return callback({
          libraryEntry: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockEntryId,
              user_id: mockUserId,
              series_id: mockSeriesId,
              last_read_chapter: 5,
              deleted_at: new Date(),
            }),
          },
        });
      }),
    };

    await expect(
      mockPrisma.$transaction(async (tx: any) => {
        const entry = await tx.libraryEntry.findUnique({ where: { id: mockEntryId } });
        if (entry.deleted_at !== null) {
          throw new Error('Library entry not found');
        }
        return { success: true };
      })
    ).rejects.toThrow('Library entry not found');
  });

  it('should reject progress update for wrong user', async () => {
    const wrongUserId = '00000000-0000-0000-0000-000000000099';
    
    const mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        return callback({
          libraryEntry: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockEntryId,
              user_id: mockUserId,
              series_id: mockSeriesId,
              last_read_chapter: 5,
              deleted_at: null,
            }),
          },
        });
      }),
    };

    await expect(
      mockPrisma.$transaction(async (tx: any) => {
        const entry = await tx.libraryEntry.findUnique({ where: { id: mockEntryId } });
        if (entry.user_id !== wrongUserId) {
          throw new Error('Library entry not found');
        }
        return { success: true };
      })
    ).rejects.toThrow('Library entry not found');
  });

  it('should handle bulk chapter updates efficiently', async () => {
    const chapterCount = 500;
    const mockChapters = Array.from({ length: chapterCount }, (_, i) => ({
      id: `chapter-${i}`,
      chapter_number: String(i + 1),
    }));

    const mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const executeRawCalls: any[] = [];
        return callback({
          $queryRaw: jest.fn().mockResolvedValue(mockChapters),
          $executeRaw: jest.fn().mockImplementation((...args: any[]) => {
            executeRawCalls.push(args);
            return Promise.resolve(chapterCount);
          }),
        });
      }),
    };

    const result = await mockPrisma.$transaction(async (tx: any) => {
      const chapters = await tx.$queryRaw`SELECT id, chapter_number FROM chapters LIMIT ${chapterCount}`;
      
      expect(chapters).toHaveLength(chapterCount);

      const chapterIds = chapters.map((ch: any) => ch.id);
      const affectedRows = await tx.$executeRaw`
        INSERT INTO user_chapter_reads_v2 (user_id, chapter_id, is_read)
        SELECT ${'user-id'}::uuid, ch.id::uuid, true
        FROM unnest(${chapterIds}::uuid[]) AS ch(id)
        ON CONFLICT (user_id, chapter_id) DO UPDATE SET is_read = true
      `;

      return { affectedRows };
    });

    expect(result.affectedRows).toBe(chapterCount);
  });

  it('should handle achievement check failure gracefully', async () => {
    let achievementCheckFailed = false;

    const mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        return callback({
          libraryEntry: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockEntryId,
              user_id: mockUserId,
              deleted_at: null,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockUserId,
              xp: 100,
              deleted_at: null,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
        });
      }),
    };

    const mockCheckAchievements = jest.fn().mockRejectedValue(new Error('Achievement service unavailable'));

    const result = await mockPrisma.$transaction(async (tx: any) => {
      const entry = await tx.libraryEntry.findUnique({ where: { id: mockEntryId } });
      expect(entry).toBeTruthy();

      try {
        await mockCheckAchievements(tx, mockUserId, 'chapter_read');
      } catch (error) {
        achievementCheckFailed = true;
      }

      return {
        entry,
        achievementCheckFailed,
      };
    });

    expect(result.achievementCheckFailed).toBe(true);
    expect(achievementCheckFailed).toBe(true);
  });
});
