import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { jobProgress, jobs, type Database, type Executor } from '@finance/db';

export type Job = typeof jobs.$inferSelect;

const LEASE_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 300;

export interface EnqueueOptions {
  workspaceId: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  maxAttempts?: number;
}

/** Enqueues a job; a repeated idempotency key returns the existing job instead of a duplicate. */
export async function enqueueJob(tx: Executor, opts: EnqueueOptions): Promise<Job> {
  const [created] = await tx
    .insert(jobs)
    .values({
      workspaceId: opts.workspaceId,
      type: opts.type,
      payload: opts.payload,
      idempotencyKey: opts.idempotencyKey,
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: [jobs.workspaceId, jobs.idempotencyKey] })
    .returning();
  if (created) {
    await tx.execute(sql`select pg_notify('jobs', ${created.id})`);
    return created;
  }
  const [existing] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.workspaceId, opts.workspaceId), eq(jobs.idempotencyKey, opts.idempotencyKey)));
  return existing!;
}

/**
 * Atomically claims the next runnable job: queued and due, or running with an expired lease
 * (its worker died). SKIP LOCKED lets several workers poll without blocking each other.
 */
export async function claimJob(db: Database, workerId: string, types: string[]): Promise<Job | null> {
  const typeList = sql.join(
    types.map((t) => sql`${t}`),
    sql`, `,
  );
  const rows = await db.execute<{ id: string }>(sql`
    update jobs set
      status = 'running',
      attempts = attempts + 1,
      locked_by = ${workerId},
      lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS}),
      heartbeat_at = now(),
      updated_at = now()
    where id = (
      select id from jobs
      where type in (${typeList})
        and ((status = 'queued' and run_after <= now()) or (status = 'running' and lease_expires_at < now()))
      order by run_after
      for update skip locked
      limit 1
    )
    returning id
  `);
  const id = rows[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

/** Extends the lease; returns false if this worker no longer owns the job. */
export async function heartbeat(db: Database, jobId: string, workerId: string): Promise<boolean> {
  const updated = await db
    .update(jobs)
    .set({ heartbeatAt: sql`now()`, leaseExpiresAt: sql`now() + make_interval(secs => ${LEASE_SECONDS})` })
    .where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId), eq(jobs.status, 'running')))
    .returning({ id: jobs.id });
  return updated.length > 0;
}

export async function completeJob(db: Executor, jobId: string) {
  await db
    .update(jobs)
    .set({ status: 'completed', completedAt: sql`now()`, updatedAt: sql`now()`, lockedBy: null, leaseExpiresAt: null })
    .where(eq(jobs.id, jobId));
}

/** Retries with bounded exponential backoff; after the last attempt the job stays `failed` for inspection. */
export async function failJob(db: Database, job: Job, error: unknown): Promise<'retrying' | 'failed'> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const exhausted = job.attempts >= job.maxAttempts;
  const backoff = Math.min(MAX_BACKOFF_SECONDS, 2 ** job.attempts * 5);
  await db
    .update(jobs)
    .set({
      status: exhausted ? 'failed' : 'queued',
      lastError: message,
      runAfter: exhausted ? undefined : sql`now() + make_interval(secs => ${backoff})`,
      lockedBy: null,
      leaseExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(jobs.id, job.id));
  return exhausted ? 'failed' : 'retrying';
}

/** Appends a durable progress record and nudges listeners. */
export async function appendProgress(db: Executor, job: Pick<Job, 'id' | 'workspaceId'>, stage: string, message?: string, data?: unknown) {
  const [record] = await db
    .insert(jobProgress)
    .values({ jobId: job.id, workspaceId: job.workspaceId, stage, message: message ?? null, data: data ?? null })
    .returning();
  await db.update(jobs).set({ progress: { stage, message: message ?? null }, updatedAt: sql`now()` }).where(eq(jobs.id, job.id));
  await db.execute(sql`select pg_notify('job_progress', ${job.id})`);
  return record!;
}

/** Progress records after a cursor, for SSE replay after reconnecting. */
export async function progressSince(db: Executor, workspaceId: string, jobId: string, afterId: number) {
  return db
    .select()
    .from(jobProgress)
    .where(and(eq(jobProgress.workspaceId, workspaceId), eq(jobProgress.jobId, jobId), gt(jobProgress.id, afterId)))
    .orderBy(asc(jobProgress.id));
}
