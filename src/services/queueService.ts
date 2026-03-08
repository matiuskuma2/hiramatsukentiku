// ==============================================
// Queue Service: Abstraction Layer
// - Production: Cloudflare Queue (SNAPSHOT_QUEUE binding)
// - Local/Fallback: cost_snapshot_jobs テーブルベースの同期実行
// ==============================================
import { SnapshotJobType, SnapshotJobStatus } from '../schemas/enums';

export interface SnapshotJobMessage {
  project_id: number;
  job_type: 'initial' | 'regenerate_preserve_reviewed' | 'regenerate_auto_only' | 'regenerate_replace_all';
  triggered_by: number; // app_users.id
  timestamp: number;
}

export interface QueueService {
  sendSnapshotJob(message: SnapshotJobMessage): Promise<{ job_id: number; mode: 'queue' | 'sync' }>;
}

/**
 * Create Queue service based on environment availability
 * - If SNAPSHOT_QUEUE binding exists → use real Cloudflare Queue
 * - Otherwise → use DB-based synchronous fallback
 */
export function createQueueService(env: {
  DB: D1Database;
  SNAPSHOT_QUEUE?: any; // Queue binding (may not exist)
}): QueueService {
  const hasQueue = !!env.SNAPSHOT_QUEUE;

  return {
    async sendSnapshotJob(message: SnapshotJobMessage) {
      // 1. Always register job in DB first (regardless of queue availability)
      const jobResult = await env.DB.prepare(`
        INSERT INTO cost_snapshot_jobs (project_id, job_type, status, triggered_by, created_at)
        VALUES (?, ?, 'queued', ?, datetime('now'))
      `).bind(message.project_id, message.job_type, message.triggered_by).run();

      const job_id = jobResult.meta.last_row_id as number;

      // 2. If Queue is available, send message to queue
      if (hasQueue) {
        try {
          await env.SNAPSHOT_QUEUE.send({
            ...message,
            job_id,
          });
          return { job_id, mode: 'queue' as const };
        } catch (e) {
          // Queue send failed → fall through to sync mode
          console.error('Queue send failed, falling back to sync:', e);
          // Update job status to indicate sync fallback
          await env.DB.prepare(
            "UPDATE cost_snapshot_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?"
          ).bind(job_id).run();
          return { job_id, mode: 'sync' as const };
        }
      }

      // 3. Sync fallback: mark as running immediately
      await env.DB.prepare(
        "UPDATE cost_snapshot_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?"
      ).bind(job_id).run();
      return { job_id, mode: 'sync' as const };
    },
  };
}

/**
 * Mark a job as completed
 */
export async function completeJob(db: D1Database, job_id: number, result_snapshot_id: number) {
  await db.prepare(`
    UPDATE cost_snapshot_jobs 
    SET status = 'completed', result_snapshot_id = ?, completed_at = datetime('now')
    WHERE id = ?
  `).bind(result_snapshot_id, job_id).run();
}

/**
 * Mark a job as failed
 */
export async function failJob(db: D1Database, job_id: number, error_message: string) {
  await db.prepare(`
    UPDATE cost_snapshot_jobs
    SET status = 'failed', error_message = ?, completed_at = datetime('now')
    WHERE id = ?
  `).bind(error_message, job_id).run();
}

/**
 * Check for exclusive constraint: only one active job per project
 */
export async function hasActiveJob(db: D1Database, project_id: number): Promise<boolean> {
  const result = await db.prepare(`
    SELECT COUNT(*) as cnt FROM cost_snapshot_jobs
    WHERE project_id = ? AND status IN ('queued', 'running')
  `).bind(project_id).first() as any;
  return (result?.cnt || 0) > 0;
}
