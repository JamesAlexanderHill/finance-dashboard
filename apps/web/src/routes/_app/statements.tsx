import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useRef, useState } from 'react';
import { TERMINAL_STAGES, type StatementStage } from '@finance/contracts';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { bytes, shortDate } from '../../lib/format';
import { useJobProgress } from '../../lib/use-job-progress';
import { deleteStatement, listStatements, restoreStatement } from '../../server/statements.functions';

const statementsQuery = queryOptions({ queryKey: ['statements'], queryFn: () => listStatements() });

export const Route = createFileRoute('/_app/statements')({
  loader: ({ context }) => context.queryClient.ensureQueryData(statementsQuery),
  component: StatementsPage,
});

type Statement = Awaited<ReturnType<typeof listStatements>>[number];

function StatementsPage() {
  const queryClient = useQueryClient();
  const statements = useSuspenseQuery(statementsQuery);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => queryClient.invalidateQueries();

  /** One request per file keeps each body small and lets earlier files start importing sooner. */
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setMessages([]);
    const errors: string[] = [];
    try {
      for (const file of files) {
        const body = new FormData();
        body.append('files', file);
        try {
          const res = await fetch('/api/statements', { method: 'POST', body });
          const data = (await res.json()) as { results?: Array<{ fileName: string; error?: string }>; error?: string };
          if (data.error) errors.push(`${file.name}: ${data.error}`);
          for (const r of data.results ?? []) if (r.error) errors.push(`${r.fileName}: ${r.error}`);
        } catch {
          errors.push(`${file.name}: upload failed`);
        }
        await refresh();
      }
    } finally {
      setMessages(errors);
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <PageHeader
        title="Statements"
        description="Uploaded files are kept privately. Deleting a statement removes its rows from your figures but keeps the file and can be undone."
        actions={
          <>
            <input
              ref={input}
              type="file"
              accept=".pdf,.csv,application/pdf,text/csv"
              multiple
              hidden
              onChange={(e) => upload(e.target.files)}
            />
            <Button variant="primary" disabled={uploading} onClick={() => input.current?.click()}>
              {uploading ? 'Uploading…' : 'Upload statements'}
            </Button>
          </>
        }
      />
      {messages.length > 0 && (
        <Card className="mb-4 p-3">
          {messages.map((m) => (
            <p key={m} className="text-negative text-sm">
              {m}
            </p>
          ))}
        </Card>
      )}
      <Card className="overflow-x-auto">
        {statements.data.length === 0 && <Empty>No statements yet. Upload a Commbank PDF statement to get started.</Empty>}
        {statements.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-muted text-left text-xs">
              <tr className="border-line border-b">
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Accounts</th>
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {statements.data.map((s) => (
                <StatementRow key={s.id} statement={s} onChange={refresh} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function StatementRow({ statement: s, onChange }: { statement: Statement; onChange: () => void }) {
  const del = useServerFn(deleteStatement);
  const restore = useServerFn(restoreStatement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = !(TERMINAL_STAGES as readonly string[]).includes(s.status);
  const progress = useJobProgress(s.jobId, running, onChange);
  const stage = (progress?.stage ?? s.status) as StatementStage | 'retrying';

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className={`border-line border-b last:border-0 ${s.deletedAt ? 'opacity-60' : ''}`}>
      <td className="px-4 py-3">
        <a href={`/api/source-files/${s.sourceFileId}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
          {s.fileName}
        </a>
        <div className="text-muted text-xs">
          {bytes(s.sizeBytes)} · uploaded {shortDate(s.uploadedAt)}
          {s.parserId && ` · ${s.parserId}@${s.parserVersion}`}
        </div>
      </td>
      <td className="px-4 py-3">{s.accounts.join(', ') || '—'}</td>
      <td className="tabular px-4 py-3 whitespace-nowrap">
        {s.periodStart ? `${shortDate(s.periodStart)} – ${shortDate(s.periodEnd)}` : '—'}
      </td>
      <td className="px-4 py-3">
        {s.deletedAt ? (
          <Badge>Deleted</Badge>
        ) : (
          <Badge tone={stage === 'completed' ? 'positive' : stage === 'failed' ? 'negative' : 'warning'}>{stage}</Badge>
        )}
        {running && progress?.message && <div className="text-muted mt-1 text-xs">{progress.message}</div>}
        {s.error && <div className="text-negative mt-1 max-w-xs text-xs">{s.error}</div>}
        {s.summary && !running && (
          <div className="text-muted mt-1 text-xs">
            {s.summary.rows} rows · {s.summary.created} new · {s.summary.linked} matched
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {/* Delete once the import has finished, whatever its outcome; a deleted statement can be restored. */}
        {(s.deletedAt || !running) &&
          (s.deletedAt ? (
            <Button disabled={busy} onClick={() => act(() => restore({ data: { id: s.id } }))}>
              Restore
            </Button>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => act(() => del({ data: { id: s.id } }))}>
              Delete
            </Button>
          ))}
        {error && <div className="text-negative mt-1 text-xs">{error}</div>}
      </td>
    </tr>
  );
}
