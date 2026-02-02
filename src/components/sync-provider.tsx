'use client';

import React from 'react';
import { useSync } from '@/hooks/use-sync';

export function SyncProvider({ children }: { children: React.ReactNode }) {
  // Initialize sync hook to start background reconciliation
  const { isOnline, pendingCount, isSyncing } = useSync();

  return (
    <>
      {children}
      {/* Optional: Indicator for non-technical users to see sync status */}
      {pendingCount > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2">
          <div className={`h-2 w-2 rounded-full ${isSyncing ? 'animate-pulse bg-yellow-400' : 'bg-green-400'}`} />
          {isSyncing ? 'Syncing...' : `${pendingCount} pending updates`}
        </div>
      )}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground shadow-lg">
          <div className="h-2 w-2 rounded-full bg-white animate-pulse" />
          Offline Mode
        </div>
      )}
    </>
  );
}
