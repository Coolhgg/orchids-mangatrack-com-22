import { SyncAction, SyncOutbox } from './outbox';

const MAX_RETRIES = 5;

// Helper to safely execute fetch with timeout and error handling
async function safeFetch(url: string, options: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Check if error is a network/connection error vs server error
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return true;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return false;
}

// Check if response is an auth error (401/403) - these should NOT be retried
function isAuthError(status: number): boolean {
  return status === 401 || status === 403;
}

// Handle auth errors by clearing the action (user needs to re-authenticate)
function handleAuthError(actionId: string, actionType: string): void {
  console.warn(`[Sync] Auth error for ${actionType} - removing action ${actionId}. User needs to re-authenticate.`);
  SyncOutbox.dequeue(actionId);
}

export const SyncReconciler = {
  async processOutbox() {
    if (typeof window === 'undefined') return;
    
    // Double-check online status
    if (!navigator.onLine) {
      console.log('[Sync] Skipping - browser is offline');
      return;
    }

    const actions = SyncOutbox.getActions();
    if (actions.length === 0) return;

    // Sort by timestamp to preserve order of operations
    const sortedActions = [...actions].sort((a, b) => a.timestamp - b.timestamp);

    // 1. Remove actions that have exceeded max retries FIRST
    const expiredActions = sortedActions.filter(a => a.retryCount >= MAX_RETRIES);
    for (const action of expiredActions) {
      console.warn(`Action ${action.id} exceeded max retries (${MAX_RETRIES}), removing from queue.`);
      SyncOutbox.dequeue(action.id);
    }

    // Filter out expired actions for processing
    const validActions = sortedActions.filter(a => a.retryCount < MAX_RETRIES);

    // 2. Group actions for batch processing if possible
    const chapterReadActions = validActions.filter(a => a.type === 'CHAPTER_READ');
    const otherActions = validActions.filter(a => a.type !== 'CHAPTER_READ');

    // 3. Batch replay CHAPTER_READ
    if (chapterReadActions.length > 0) {
      try {
        const response = await safeFetch('/api/sync/replay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actions: chapterReadActions }),
          credentials: 'include',
        });

        if (response.ok) {
            const { results } = await response.json();
            for (const res of results) {
              if (res.status === 'success') {
                SyncOutbox.dequeue(res.id);
              } else {
                SyncOutbox.updateRetry(res.id);
              }
            }
          } else if (isAuthError(response.status)) {
            // Auth error - clear all actions in this batch, user needs to re-login
            chapterReadActions.forEach(a => handleAuthError(a.id, 'CHAPTER_READ_BATCH'));
          } else {
             chapterReadActions.forEach(a => SyncOutbox.updateRetry(a.id));
          }
      } catch (error) {
        // Only log if not a simple network error
        if (!isNetworkError(error)) {
          console.error('Batch sync failed:', error);
        }
        chapterReadActions.forEach(a => SyncOutbox.updateRetry(a.id));
      }
    }

    // 4. Process remaining actions sequentially
    for (const action of otherActions) {
      try {
        const success = await this.executeAction(action);
        if (success) {
          SyncOutbox.dequeue(action.id);
        } else {
          SyncOutbox.updateRetry(action.id);
        }
      } catch (error) {
        if (!isNetworkError(error)) {
          console.error(`Failed to process action ${action.id}:`, error);
        }
        SyncOutbox.updateRetry(action.id);
      }
    }
  },

  async executeAction(action: SyncAction): Promise<boolean> {
    const { type, payload } = action;

    switch (type) {
        case 'CHAPTER_READ':
          return this.handleChapterRead(action);
        case 'LIBRARY_UPDATE':
          return this.handleLibraryUpdate(payload);
          case 'LIBRARY_DELETE':
            return this.handleLibraryDelete(payload);
          case 'LIBRARY_ADD':
            return this.handleLibraryAdd(payload);
          case 'SETTING_UPDATE':
          return this.handleSettingUpdate(payload);
      default:
        return true; // Unknown actions are considered "processed"
    }
  },

  async handleChapterRead(action: SyncAction) {
    const { payload, timestamp, deviceId } = action;
    const response = await fetch(`/api/library/${payload.entryId}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterNumber: payload.chapterNumber,
        sourceId: payload.sourceId,
        timestamp: new Date(timestamp).toISOString(),
        deviceId: deviceId,
      }),
      credentials: 'include',
    });

    // Auth errors should be handled specially - don't retry
    if (isAuthError(response.status)) {
      handleAuthError(action.id, 'CHAPTER_READ');
      return true; // Return true to prevent additional retry logic
    }

    if (!response.ok && response.status !== 409) {
      try {
        const errorData = await response.json();
        console.error(`Sync error (CHAPTER_READ) [${response.status}]:`, errorData.message || errorData.error || 'Unknown error');
      } catch {
        console.error(`Sync error (CHAPTER_READ) [${response.status}]: Failed to parse error response`);
      }
    }

    return response.ok || response.status === 409;
  },

  async handleLibraryUpdate(payload: { entryId: string; status?: string; rating?: number }) {
    const response = await fetch(`/api/library/${payload.entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: payload.status,
        rating: payload.rating,
      }),
      credentials: 'include',
    });

    // Auth errors should not be retried
    if (isAuthError(response.status)) {
      return true; // Will be dequeued by caller
    }

    if (!response.ok) {
      try {
        const errorData = await response.json();
        console.error(`Sync error (LIBRARY_UPDATE) [${response.status}]:`, errorData.message || errorData.error || 'Unknown error');
      } catch {
        console.error(`Sync error (LIBRARY_UPDATE) [${response.status}]: Failed to parse error response`);
      }
    }

    return response.ok;
  },

  async handleLibraryDelete(payload: { entryId: string }) {
    const response = await fetch(`/api/library/${payload.entryId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    
    // Auth errors should not be retried
    if (isAuthError(response.status)) {
      return true;
    }
    
    return response.ok || response.status === 404;
  },

  async handleLibraryAdd(payload: { seriesId: string; status?: string }) {
    const response = await fetch(`/api/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId: payload.seriesId,
        status: payload.status || 'reading',
      }),
      credentials: 'include',
    });

    // Auth errors should not be retried
    if (isAuthError(response.status)) {
      return true;
    }

    if (!response.ok) {
      try {
        const errorData = await response.json();
        console.error(`Sync error (LIBRARY_ADD) [${response.status}]:`, errorData.message || errorData.error || 'Unknown error');
      } catch {
        console.error(`Sync error (LIBRARY_ADD) [${response.status}]: Failed to parse error response`);
      }
    }

    return response.ok;
  },

  async handleSettingUpdate(payload: { userId: string; settings: any }) {
    const response = await fetch(`/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.settings),
      credentials: 'include',
    });
    
    // Auth errors should not be retried
    if (isAuthError(response.status)) {
      return true;
    }
    
    return response.ok;
  },

  /**
   * Reconciles derived counters to prevent drift (BUG 85)
   * Recalculates stats from source tables rather than relying on incremental updates.
   * 
   * BUG-06 FIX: chapters_read should count actual chapter read records,
   * NOT sum of last_read_chapter values (which are chapter numbers, not counts)
   */
  async reconcileUserStats(userId: string) {
    const { prisma } = await import("@/lib/prisma");

    // BUG-06 FIX: Count chapter read records instead of summing chapter numbers
    const [chaptersReadCount, libraryCount] = await Promise.all([
      // Count actual chapter reads from the UserChapterReadV2 table
      prisma.userChapterReadV2.count({
        where: { 
          user_id: userId,
          is_read: true,
        }
      }),
      prisma.libraryEntry.count({
        where: { 
          user_id: userId,
          deleted_at: null, // Only count non-deleted entries
        }
      })
    ]);

    await prisma.user.update({
      where: { id: userId },
      data: {
        chapters_read: chaptersReadCount,
        // Add other derived fields as needed
      }
    });
  }
};
