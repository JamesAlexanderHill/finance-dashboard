import { createFileRoute } from '@tanstack/react-router';
import { and, eq } from 'drizzle-orm';
import { TERMINAL_STAGES, type JobProgressRecord } from '@finance/contracts';
import { getDb, jobs } from '@finance/db';
import { progressSince } from '@finance/imports';
import { json, withErrors } from '../../../../server/http';
import { requireWorkspace } from '../../../../server/session.server';

const POLL_MS = 750;
const KEEPALIVE_MS = 15_000;

/**
 * SSE stream of a job's durable progress records. Clients resume with `Last-Event-ID`
 * (sent automatically by EventSource) or `?after=<id>`; the stream ends after a terminal stage.
 */
export const Route = createFileRoute('/api/jobs/$jobId/events')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withErrors(async () => {
          const { workspaceId } = await requireWorkspace(request);
          const db = getDb();
          const [job] = await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(and(eq(jobs.id, params.jobId), eq(jobs.workspaceId, workspaceId)));
          if (!job) return json({ error: 'Not found' }, 404);

          const url = new URL(request.url);
          let cursor = Number(request.headers.get('last-event-id') ?? url.searchParams.get('after') ?? 0) || 0;
          const encoder = new TextEncoder();

          const stream = new ReadableStream({
            async start(controller) {
              let closed = false;
              const close = () => {
                if (closed) return;
                closed = true;
                controller.close();
              };
              request.signal.addEventListener('abort', close);
              let lastWrite = Date.now();
              controller.enqueue(encoder.encode('retry: 2000\n\n'));

              while (!closed) {
                const records = await progressSince(db, workspaceId, job.id, cursor);
                for (const r of records) {
                  const payload: JobProgressRecord = {
                    id: r.id,
                    jobId: r.jobId,
                    stage: r.stage,
                    message: r.message,
                    data: r.data,
                    createdAt: r.createdAt.toISOString(),
                  };
                  controller.enqueue(encoder.encode(`id: ${r.id}\nevent: progress\ndata: ${JSON.stringify(payload)}\n\n`));
                  cursor = r.id;
                  lastWrite = Date.now();
                }
                if (records.some((r) => (TERMINAL_STAGES as readonly string[]).includes(r.stage))) {
                  controller.enqueue(encoder.encode('event: end\ndata: {}\n\n'));
                  close();
                  break;
                }
                if (Date.now() - lastWrite > KEEPALIVE_MS) {
                  controller.enqueue(encoder.encode(': keep-alive\n\n'));
                  lastWrite = Date.now();
                }
                await new Promise((r) => setTimeout(r, POLL_MS));
              }
            },
          });

          return new Response(stream, {
            headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
          });
        }),
    },
  },
});
