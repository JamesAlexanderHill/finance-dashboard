import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useRef, useState, type FormEvent } from 'react';
import type { PriceCsvMappingInput } from '@finance/contracts';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { useJobProgress } from '../../lib/use-job-progress';
import {
  addManualPrice,
  choosePrice,
  deletePriceFile,
  importPriceFile,
  listInstruments,
  listPriceConflicts,
  listPriceFiles,
  previewPriceFile,
  restorePriceFile,
} from '../../server/prices.functions';

const filesQuery = queryOptions({ queryKey: ['price-files'], queryFn: () => listPriceFiles() });
const instrumentsQuery = queryOptions({ queryKey: ['instruments'], queryFn: () => listInstruments() });
const conflictsQuery = queryOptions({ queryKey: ['price-conflicts'], queryFn: () => listPriceConflicts() });

export const Route = createFileRoute('/_app/prices')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(filesQuery),
      context.queryClient.ensureQueryData(instrumentsQuery),
      context.queryClient.ensureQueryData(conflictsQuery),
    ]),
  component: PricesPage,
});

type Instrument = Awaited<ReturnType<typeof listInstruments>>[number];
const select = 'border-line bg-surface rounded border px-2 py-1.5 text-sm';

function PricesPage() {
  const queryClient = useQueryClient();
  const { data: files } = useSuspenseQuery(filesQuery);
  const { data: instruments } = useSuspenseQuery(instrumentsQuery);
  const { data: conflicts } = useSuspenseQuery(conflictsQuery);
  const [mapping, setMapping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => queryClient.invalidateQueries();

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/prices', { method: 'POST', body });
    const data = (await res.json()) as { sourceFileId?: string; error?: string };
    if (input.current) input.current.value = '';
    if (data.error) return setError(data.error);
    await refresh();
    setMapping(data.sourceFileId!);
  }

  return (
    <>
      <PageHeader
        title="Prices"
        description="Import daily unit prices from CSV, enter a price by hand, and settle conflicting prices. Statements add closing and trade prices automatically."
        actions={
          <>
            <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
            <Button variant="primary" disabled={instruments.length === 0} onClick={() => input.current?.click()}>
              Upload price CSV
            </Button>
          </>
        }
      />
      {instruments.length === 0 && (
        <p className="text-muted mb-4 text-sm">
          Instruments appear when you import an investment statement; prices can be added after that.
        </p>
      )}
      {error && <p className="text-negative mb-4 text-sm">{error}</p>}
      {mapping && <MappingForm sourceFileId={mapping} instruments={instruments} onDone={() => setMapping(null)} />}

      {conflicts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-medium">Conflicting prices</h2>
          <p className="text-muted mb-2 text-xs">Sources disagree on these prices. None is used until you choose one.</p>
          <Card>
            {conflicts.map((c) => (
              <ConflictRow key={c.key} conflict={c} onChange={refresh} />
            ))}
          </Card>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium">Price files</h2>
        <Card>
          {files.length === 0 && <Empty>No price files yet.</Empty>}
          {files.map((f) => (
            <PriceFileRow key={f.id} file={f} onMap={() => setMapping(f.id)} onChange={refresh} />
          ))}
        </Card>
      </section>

      {instruments.length > 0 && <ManualPrice instruments={instruments} onChange={refresh} />}
    </>
  );
}

function MappingForm({ sourceFileId, instruments, onDone }: { sourceFileId: string; instruments: Instrument[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const fetchPreview = useServerFn(previewPriceFile);
  const start = useServerFn(importPriceFile);
  const preview = useQuery({ queryKey: ['price-preview', sourceFileId], queryFn: () => fetchPreview({ data: { id: sourceFileId } }) });
  const header = preview.data?.header ?? [];
  const guess = (re: RegExp) => header.find((h) => re.test(h)) ?? '';
  const [form, setForm] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'fixed' | 'column'>('fixed');
  const [error, setError] = useState<string | null>(null);
  const value = (key: string, fallback: string) => form[key] ?? fallback;
  const set = (key: string) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const mapping: PriceCsvMappingInput = {
      dateColumn: value('dateColumn', guess(/date/i)),
      dateFormat: value('dateFormat', 'YYYY-MM-DD') as PriceCsvMappingInput['dateFormat'],
      priceColumn: value('priceColumn', guess(/close|price/i)),
      ...(mode === 'fixed'
        ? { instrumentId: value('instrumentId', instruments[0]?.id ?? '') }
        : { instrumentColumn: value('instrumentColumn', guess(/symbol|code|ticker/i)) }),
      ...(form.currencyColumn ? { currencyColumn: form.currencyColumn } : {}),
    };
    try {
      await start({ data: { sourceFileId, mapping } });
      await queryClient.invalidateQueries();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the import');
    }
  };

  const columnSelect = (key: string, fallback: string, optional = false) => (
    <select value={value(key, fallback)} onChange={set(key)} className={select}>
      {optional && <option value="">—</option>}
      {header.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </select>
  );

  return (
    <Card className="mb-6 p-4">
      <h2 className="mb-1 text-sm font-medium">Map columns · {preview.data?.fileName}</h2>
      <p className="text-muted mb-3 text-xs">
        {preview.data ? `${preview.data.rowCount} rows. Each row becomes one daily price.` : 'Reading file…'}
      </p>
      {preview.data && (
        <div className="mb-4 overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                {header.map((h) => (
                  <th key={h} className="border-line border-b px-2 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.data.sample.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="text-muted tabular px-2 py-0.5">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={submit} className="grid gap-3 text-sm sm:grid-cols-2">
        <label className="flex flex-col gap-1">Date column {columnSelect('dateColumn', guess(/date/i))}</label>
        <label className="flex flex-col gap-1">
          Date format
          <select value={value('dateFormat', 'YYYY-MM-DD')} onChange={set('dateFormat')} className={select}>
            <option>YYYY-MM-DD</option>
            <option>DD/MM/YYYY</option>
            <option>MM/DD/YYYY</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">Price column {columnSelect('priceColumn', guess(/close|price/i))}</label>
        <div className="flex flex-col gap-1">
          <span>
            Instrument{' '}
            <button type="button" className="text-accent text-xs underline" onClick={() => setMode(mode === 'fixed' ? 'column' : 'fixed')}>
              {mode === 'fixed' ? 'use a column instead' : 'use one instrument'}
            </button>
          </span>
          {mode === 'fixed' ? (
            <select value={value('instrumentId', instruments[0]?.id ?? '')} onChange={set('instrumentId')} className={select}>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol} · {i.exchange} · {i.name}
                </option>
              ))}
            </select>
          ) : (
            columnSelect('instrumentColumn', guess(/symbol|code|ticker/i))
          )}
        </div>
        <label className="flex flex-col gap-1">
          Currency column (optional; defaults to the instrument&apos;s currency) {columnSelect('currencyColumn', '', true)}
        </label>
        <div className="flex items-end gap-2">
          <Button variant="primary" type="submit" disabled={!preview.data}>
            Import prices
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Later
          </Button>
        </div>
      </form>
      {error && <p className="text-negative mt-2 text-xs">{error}</p>}
    </Card>
  );
}

type PriceFile = Awaited<ReturnType<typeof listPriceFiles>>[number];

function PriceFileRow({ file, onMap, onChange }: { file: PriceFile; onMap: () => void; onChange: () => void }) {
  const del = useServerFn(deletePriceFile);
  const restore = useServerFn(restorePriceFile);
  const running = file.job?.status === 'queued' || file.job?.status === 'running';
  const progress = useJobProgress(file.job?.id, running, onChange);
  const [showErrors, setShowErrors] = useState(false);
  const s = file.summary;

  return (
    <div className={`border-line border-b px-4 py-3 text-sm last:border-0 ${file.deletedAt ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{file.fileName}</span>
        <span className="text-muted text-xs">uploaded {shortDate(file.uploadedAt)}</span>
        {file.deletedAt && <Badge>Deleted</Badge>}
        {!file.job && <Badge tone="warning">Not imported</Badge>}
        {running && <Badge tone="warning">{progress?.message ?? 'Importing…'}</Badge>}
        {file.job?.status === 'failed' && <Badge tone="negative">Failed</Badge>}
        <div className="ml-auto flex gap-1">
          {!file.job && !file.deletedAt && <Button onClick={onMap}>Map &amp; import</Button>}
          {file.deletedAt ? (
            <Button onClick={() => restore({ data: { id: file.id } }).then(onChange)}>Restore</Button>
          ) : (
            <Button variant="ghost" onClick={() => del({ data: { id: file.id } }).then(onChange)}>
              Delete
            </Button>
          )}
        </div>
      </div>
      {s && (
        <div className="text-muted mt-1 text-xs">
          {s.rows} rows · {s.inserted} recorded · {s.duplicates} already known · {s.conflicts} conflicts ·{' '}
          {s.errorCount > 0 ? (
            <button className="text-negative underline" onClick={() => setShowErrors(!showErrors)}>
              {s.errorCount} rejected
            </button>
          ) : (
            '0 rejected'
          )}
        </div>
      )}
      {showErrors && s && (
        <ul className="text-muted mt-1 max-h-48 overflow-y-auto text-xs">
          {s.errors.map((e) => (
            <li key={e.line}>
              Line {e.line}: {e.error}
            </li>
          ))}
          {s.errorCount > s.errors.length && <li>…and {s.errorCount - s.errors.length} more</li>}
        </ul>
      )}
    </div>
  );
}

type Conflict = Awaited<ReturnType<typeof listPriceConflicts>>[number];

function ConflictRow({ conflict, onChange }: { conflict: Conflict; onChange: () => void }) {
  const choose = useServerFn(choosePrice);
  return (
    <div className="border-line border-b px-4 py-3 text-sm last:border-0">
      <div className="font-medium">
        {conflict.symbol} · {shortDate(conflict.observedOn)}
      </div>
      {conflict.options.map((o) => (
        <div key={o.id} className="mt-1 flex flex-wrap items-center gap-3">
          <span className="tabular w-28">{money(o.price, o.currency)}</span>
          <span className="text-muted flex-1 text-xs">
            {o.source === 'manual' ? 'Entered by hand' : `${o.fileName ?? o.source}${o.sourceRow ? `, line ${o.sourceRow}` : ''}`}
          </span>
          <Button onClick={() => choose({ data: { observationId: o.id } }).then(onChange)}>Use this price</Button>
        </div>
      ))}
    </div>
  );
}

function ManualPrice({ instruments, onChange }: { instruments: Instrument[]; onChange: () => void }) {
  const add = useServerFn(addManualPrice);
  const [instrumentId, setInstrumentId] = useState(instruments[0]!.id);
  const [observedOn, setObservedOn] = useState('');
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      const result = await add({ data: { instrumentId, observedOn, price } });
      setMessage(result.conflicts ? 'Saved; it conflicts with another manual price for that day.' : 'Saved.');
      setPrice('');
      onChange();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">Enter a price</h2>
      <Card className="p-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 text-sm">
          <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} className={select} aria-label="Instrument">
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} · {i.exchange}
              </option>
            ))}
          </select>
          <input
            type="date"
            required
            value={observedOn}
            onChange={(e) => setObservedOn(e.target.value)}
            className={select}
            aria-label="Date"
          />
          <input
            required
            inputMode="decimal"
            placeholder="Unit price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={`${select} tabular w-32`}
            aria-label="Unit price"
          />
          <Button variant="primary" type="submit">
            Save price
          </Button>
          {message && <span className="text-muted text-xs">{message}</span>}
        </form>
      </Card>
    </section>
  );
}
