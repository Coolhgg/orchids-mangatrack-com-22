import { Job } from 'bullmq';
import { processImportJob } from '@/lib/sync/import-pipeline';
import { logger } from '@/lib/logger';
import { prisma, isTransientError } from '@/lib/prisma';

interface ImportJobData {
  jobId: string;
}

interface ImportError extends Error {
  code?: string;
  isRetryable?: boolean;
}

/**
 * Processor for the import queue.
 * Handles background processing of series import jobs (CSV, MAL, etc).
 * 
 * Error Handling:
 * - Validates job data before processing
 * - Categorizes errors as retryable vs permanent
 * - Updates job status on permanent failures
 * - Uses structured logging
 */
export async function processImport(job: Job<ImportJobData>) {
  const { jobId } = job.data;
  
  if (!jobId) {
    logger.error('[ImportWorker] Missing jobId in import job data', { 
      bullmqJobId: job.id,
      attemptsMade: job.attemptsMade 
    });
    throw new Error('Missing jobId in import job data');
  }

  const startTime = Date.now();
  logger.info(`[ImportWorker] Starting import job`, { 
    jobId, 
    bullmqJobId: job.id,
    attempt: job.attemptsMade + 1 
  });
  
  try {
    await processImportJob(jobId);
    
    const duration = Date.now() - startTime;
    logger.info(`[ImportWorker] Successfully completed import job`, { 
      jobId, 
      durationMs: duration 
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const err = error as ImportError;
    
    const isRetryable = isTransientError(error) || 
      err.message?.includes('timeout') || 
      err.message?.includes('connection') ||
      err.code === 'P2024'; // Prisma timeout
    
    logger.error(`[ImportWorker] Failed to process import job`, {
      jobId,
      bullmqJobId: job.id,
      attempt: job.attemptsMade + 1,
      durationMs: duration,
      error: err.message,
      errorCode: err.code,
      isRetryable,
      stack: err.stack?.slice(0, 500)
    });
    
    if (!isRetryable && job.attemptsMade >= (job.opts?.attempts || 3) - 1) {
      try {
        await prisma.importJob.update({
          where: { id: jobId },
          data: { 
            status: 'failed',
            completed_at: new Date()
          }
        });
        logger.info(`[ImportWorker] Marked import job as permanently failed`, { jobId });
      } catch (updateError) {
        logger.error(`[ImportWorker] Failed to update job status to failed`, { 
          jobId, 
          error: updateError instanceof Error ? updateError.message : String(updateError)
        });
      }
    }
    
    throw error;
  }
}
