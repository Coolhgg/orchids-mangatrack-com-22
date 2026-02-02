import { logger } from '@/lib/logger';
import { Queue, Job } from 'bullmq';

// Type for job data that could contain libraryEntryId
interface JobDataWithEntry {
  libraryEntryId?: string;
  seriesId?: string;
  sourceName?: string;
}

let seriesResolutionQueue: Queue | null = null;
let syncSourceQueue: Queue | null = null;

async function getQueues(): Promise<{ seriesResolutionQueue: Queue | null; syncSourceQueue: Queue | null } | null> {
  if (!seriesResolutionQueue || !syncSourceQueue) {
    try {
      const queues = await import('@/lib/queues');
      seriesResolutionQueue = queues.seriesResolutionQueue as Queue;
      syncSourceQueue = queues.syncSourceQueue as Queue;
    } catch (err) {
      logger.warn('Queues not available for job cleanup', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
  return { seriesResolutionQueue, syncSourceQueue };
}

export async function cancelJobsForLibraryEntry(libraryEntryId: string): Promise<{ cancelled: number; errors: string[] }> {
  const result = { cancelled: 0, errors: [] as string[] };
  
  const queues = await getQueues();
  if (!queues) {
    return result;
  }

  const { seriesResolutionQueue: resolutionQueue, syncSourceQueue: syncQueue } = queues;
  const jobStates: Array<'waiting' | 'delayed' | 'active'> = ['waiting', 'delayed', 'active'];

  // Cancel resolution jobs
  try {
    if (resolutionQueue) {
      const resolutionJobs = await resolutionQueue.getJobs(jobStates);
      for (const job of resolutionJobs) {
        const jobData = job.data as JobDataWithEntry;
        if (jobData?.libraryEntryId === libraryEntryId) {
          try {
            await job.remove();
            result.cancelled++;
            logger.info(`[JobCleanup] Cancelled resolution job ${job.id} for entry ${libraryEntryId}`);
          } catch (removeErr) {
            const errMsg = removeErr instanceof Error ? removeErr.message : String(removeErr);
            result.errors.push(`Failed to remove resolution job ${job.id}: ${errMsg}`);
          }
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to get resolution jobs: ${errMsg}`);
  }

  // Cancel sync jobs
  try {
    if (syncQueue) {
      const syncJobs = await syncQueue.getJobs(jobStates);
      for (const job of syncJobs) {
        const jobData = job.data as JobDataWithEntry;
        if (jobData?.libraryEntryId === libraryEntryId) {
          try {
            await job.remove();
            result.cancelled++;
            logger.info(`[JobCleanup] Cancelled sync job ${job.id} for entry ${libraryEntryId}`);
          } catch (removeErr) {
            const errMsg = removeErr instanceof Error ? removeErr.message : String(removeErr);
            result.errors.push(`Failed to remove sync job ${job.id}: ${errMsg}`);
          }
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to get sync jobs: ${errMsg}`);
  }

  if (result.cancelled > 0) {
    logger.info(`[JobCleanup] Cancelled ${result.cancelled} jobs for deleted library entry ${libraryEntryId}`);
  }

  return result;
}

export async function cancelJobsForSeries(seriesId: string): Promise<{ cancelled: number; errors: string[] }> {
  const result = { cancelled: 0, errors: [] as string[] };
  
  const queues = await getQueues();
  if (!queues) {
    return result;
  }

  const { syncSourceQueue: syncQueue } = queues;
  const jobStates: Array<'waiting' | 'delayed' | 'active'> = ['waiting', 'delayed', 'active'];

  try {
    if (syncQueue) {
      const syncJobs = await syncQueue.getJobs(jobStates);
      for (const job of syncJobs) {
        const jobData = job.data as JobDataWithEntry;
        if (jobData?.seriesId === seriesId) {
          try {
            await job.remove();
            result.cancelled++;
            logger.info(`[JobCleanup] Cancelled sync job ${job.id} for series ${seriesId}`);
          } catch (removeErr) {
            const errMsg = removeErr instanceof Error ? removeErr.message : String(removeErr);
            result.errors.push(`Failed to remove sync job ${job.id}: ${errMsg}`);
          }
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to get sync jobs: ${errMsg}`);
  }

  return result;
}

export async function cancelJobsForSource(sourceName: string): Promise<{ cancelled: number; errors: string[] }> {
  const result = { cancelled: 0, errors: [] as string[] };
  
  const queues = await getQueues();
  if (!queues) {
    return result;
  }

  const { syncSourceQueue: syncQueue } = queues;
  const jobStates: Array<'waiting' | 'delayed' | 'active'> = ['waiting', 'delayed', 'active'];

  try {
    if (syncQueue) {
      const syncJobs = await syncQueue.getJobs(jobStates);
      for (const job of syncJobs) {
        const jobData = job.data as JobDataWithEntry;
        if (jobData?.sourceName === sourceName) {
          try {
            await job.remove();
            result.cancelled++;
          } catch (removeErr) {
            const errMsg = removeErr instanceof Error ? removeErr.message : String(removeErr);
            result.errors.push(`Failed to remove sync job ${job.id}: ${errMsg}`);
          }
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to get sync jobs: ${errMsg}`);
  }

  if (result.cancelled > 0) {
    logger.info(`[JobCleanup] Cancelled ${result.cancelled} jobs for disabled source ${sourceName}`);
  }

  return result;
}
