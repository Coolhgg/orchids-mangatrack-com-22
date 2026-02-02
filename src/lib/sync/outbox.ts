import { getDeviceId } from './device';

export type SyncActionType = 'LIBRARY_UPDATE' | 'CHAPTER_READ' | 'SETTING_UPDATE' | 'LIBRARY_DELETE' | 'LIBRARY_ADD';

export interface SyncAction {
  id: string;
  type: SyncActionType;
  payload: any;
  timestamp: number;
  deviceId: string;
  retryCount: number;
}

const OUTBOX_KEY = 'mangatrack_sync_outbox';

export const SyncOutbox = {
  getActions(): SyncAction[] {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(OUTBOX_KEY);
    return stored ? JSON.parse(stored) : [];
  },

  enqueue(type: SyncActionType, payload: any) {
    const actions = this.getActions();
    const newAction: SyncAction = {
      id: crypto.randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
      deviceId: getDeviceId(),
      retryCount: 0,
    };
    
    // Deduplication logic
    let updatedActions = actions;
    if (type === 'CHAPTER_READ') {
      // Keep only the highest chapter for the same series (v2.2.0)
      const existing = actions.find(a => 
        a.type === 'CHAPTER_READ' && a.payload.entryId === payload.entryId
      );
      
      if (existing) {
        if (payload.chapterNumber > existing.payload.chapterNumber) {
          updatedActions = actions.filter(a => a.id !== existing.id);
        } else {
          // New chapter is lower or equal, ignore it
          return existing.id;
        }
      }
    } else if (type === 'LIBRARY_UPDATE') {
      // If we're updating the same entry, keep only the latest update
      updatedActions = actions.filter(a => 
        !(a.type === 'LIBRARY_UPDATE' && a.payload.entryId === payload.entryId)
      );
    } else if (type === 'LIBRARY_ADD') {
      // If we're adding the same series, keep only the latest add action
      updatedActions = actions.filter(a => 
        !(a.type === 'LIBRARY_ADD' && a.payload.seriesId === payload.seriesId)
      );
    }

    updatedActions.push(newAction);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(updatedActions));
    
    // Dispatch event for hooks to listen to
    window.dispatchEvent(new Event('sync-outbox-updated'));
    return newAction.id;
  },

  dequeue(id: string) {
    const actions = this.getActions();
    const updated = actions.filter(a => a.id !== id);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('sync-outbox-updated'));
  },

  updateRetry(id: string) {
    const actions = this.getActions();
    const action = actions.find(a => a.id === id);
    if (action) {
      action.retryCount += 1;
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(actions));
    }
  },

  clear() {
    localStorage.removeItem(OUTBOX_KEY);
    window.dispatchEvent(new Event('sync-outbox-updated'));
  }
};
