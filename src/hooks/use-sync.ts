'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { SyncOutbox } from '@/lib/sync/outbox';
import { SyncReconciler } from '@/lib/sync/reconciler';

export function useSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const updateStatus = useCallback(() => {
      setIsOnline(navigator.onLine);
      setPendingCount(SyncOutbox.getActions().length);
    }, []);

    const sync = useCallback(async () => {
      // Only sync if online, not already syncing, and there's something to sync
      const pending = SyncOutbox.getActions().length;
      if (!navigator.onLine || isSyncingRef.current || pending === 0) return;
      
      isSyncingRef.current = true;
      setIsSyncing(true);
      try {
        await SyncReconciler.processOutbox();
      } finally {
        isSyncingRef.current = false;
        setIsSyncing(false);
        updateStatus();
      }
    }, [updateStatus]);

    const handleOutboxUpdate = useCallback(() => {
      updateStatus();
      if (navigator.onLine && !isSyncingRef.current) {
        sync();
      }
    }, [updateStatus, sync]);

    useEffect(() => {
      if (typeof window === 'undefined') return;

      // Initial status
      updateStatus();

      // Listen for connectivity changes
      window.addEventListener('online', sync);
      window.addEventListener('offline', updateStatus);
      
      // Listen for outbox changes (from other hooks or tabs)
      window.addEventListener('sync-outbox-updated', handleOutboxUpdate);
      
      // Auto-sync on mount if online and has pending items
      if (navigator.onLine && SyncOutbox.getActions().length > 0) {
        sync();
      }


    // Periodic sync attempt (every 5 minutes) - only syncs if pending > 0 (checked in sync())
    intervalRef.current = setInterval(sync, 5 * 60 * 1000);

    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', updateStatus);
      window.removeEventListener('sync-outbox-updated', handleOutboxUpdate);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [sync, updateStatus, handleOutboxUpdate]);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    sync
  };
}
