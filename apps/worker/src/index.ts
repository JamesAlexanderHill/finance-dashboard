import { hostname } from 'node:os';
import { eq } from 'drizzle-orm';
import { JOB_TYPES, statementImportPayload } from '@finance/contracts';
import { createDb, statements } from '@finance/db';
import { appendProgress, claimJob, completeJob, failJob, getStorage, heartbeat, runStatementImport, type Job } from '@finance/imports';

const workerId = `${hostname()}:${process.pid}`;
const POLL_MS = 2000;
const HEARTBEAT_MS = 15_000;

const { db, client } = createDb();
const storage = getStorage();
let stopping = false;
let wake: (() => void) | undefined;

const handlers: Record<string, (job: Job) => Promise<void>> = {
  [JOB_TYPES.statementImport]: async (job) => {
    const { statementId } = statementImportPayload.parse(job.payload);
    await runStatementImport(db, storage, job, statementId);
  },
};

async function runJob(job: Job) {
  const beat = setInterval(() => void heartbeat(db, job.id, workerId).catch(() => {}), HEARTBEAT_MS);
  try {
    await handlers[job.type]!(job);
    await completeJob(db, job.id);
    console.log(`[worker] completed ${job.type} ${job.id}`);
  } catch (err) {
    const outcome = await failJob(db, job, err);
    console.error(`[worker] ${job.type} ${job.id} attempt ${job.attempts} failed (${outcome}):`, err);
    await appendProgress(db, job, outcome === 'failed' ? 'failed' : 'retrying', err instanceof Error ? err.message : String(err));
    if (outcome === 'failed' && job.type === JOB_TYPES.statementImport) {
      const { statementId } = statementImportPayload.parse(job.payload);
      await db
        .update(statements)
        .set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
        .where(eq(statements.id, statementId));
    }
  } finally {
    clearInterval(beat);
  }
}

async function loop() {
  while (!stopping) {
    const job = await claimJob(db, workerId, Object.keys(handlers)).catch((err) => {
      console.error('[worker] claim failed', err);
      return null;
    });
    if (job) {
      await runJob(job);
      continue;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_MS);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

// NOTIFY only shortens latency; polling (and stale-lease recovery) is the durable path.
await client.listen('jobs', () => wake?.());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal}: finishing current job then exiting`);
    stopping = true;
    wake?.();
  });
}

console.log(`[worker] ${workerId} started`);
await loop();
await client.end();
process.exit(0);
