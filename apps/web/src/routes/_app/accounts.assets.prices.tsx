import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useRef, useState, type FormEvent } from 'react';
import type { PriceCsvMappingInput } from '@finance/contracts';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { useJobProgress } from '../../lib/use-job-progress';
import {
  addAlias,
  addManualPrice,
  choosePrice,
  deletePriceFile,
  importPriceFile,
  listAliases,
  listFxRates,
  listInstruments,
  listPriceConflicts,
  listPriceFiles,
  listUnresolvedInstruments,
  previewPriceFile,
  removeAlias,
  restorePriceFile,
} from '../../server/prices.functions';

const filesQuery = queryOptions({ queryKey: ['price-files'], queryFn: () => listPriceFiles() });
const instrumentsQuery = queryOptions({ queryKey: ['instruments'], queryFn: () => listInstruments() });
const conflictsQuery = queryOptions({ queryKey: ['price-conflicts'], queryFn: () => listPriceConflicts() });
const fxQuery = queryOptions({ queryKey: ['fx-rates'], queryFn: () => listFxRates() });
const aliasesQuery = queryOptions({ queryKey: ['instrument-aliases'], queryFn: () => listAliases() });

export const Route = createFileRoute('/_app/accounts/assets/prices')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(filesQuery),
      context.queryClient.ensureQueryData(instrumentsQuery),
      context.queryClient.ensureQueryData(conflictsQuery),
      context.queryClient.ensureQueryData(fxQuery),
      context.queryClient.ensureQueryData(aliasesQuery),
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
  const { data: fxRates } = useSuspenseQuery(fxQuery);
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

      {fxRates.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-medium">FX rates</h2>
          <p className="text-muted mb-2 text-xs">
            AUD per unit of each currency you hold. Import daily rates as a price CSV (instrument values such as USDAUD or USD/AUD), or
            enter one by hand.
          </p>
          <Card>
            {fxRates.map((r) => (
              <div key={r.id} className="border-line flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm last:border-0">
                <span className="w-24 font-medium">
                  {r.symbol}/{r.currency}
                </span>
                {r.rate ? (
                  <>
                    <span className="tabular">{Number(r.rate.price).toFixed(4)}</span>
                    <span className="text-muted text-xs">from {shortDate(r.rate.on)}</span>
                    {r.rate.stale && <Badge tone="warning">Stale</Badge>}
                    {r.rate.tradePriced && <Badge tone="warning">From a conversion</Badge>}
                  </>
                ) : (
                  <Badge tone="negative">No rate</Badge>
                )}
                {r.override && <Badge>Override {Number(r.override).toFixed(4)}</Badge>}
                <Link to="/accounts/assets/$instrumentId" params={{ instrumentId: r.id }} className="text-accent ml-auto text-xs underline">
                  History &amp; override
                </Link>
              </div>
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
      {instruments.length > 0 && <Aliases instruments={instruments} />}
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
                  {instrumentLabel(i)}
                </option>
              ))}
            </select>
          ) : (
            columnSelect('instrumentColumn', guess(/symbol|code|ticker/i))
          )}
        </div>
        {mode === 'column' && preview.data && (
          <UnresolvedNames
            sourceFileId={sourceFileId}
            column={value('instrumentColumn', guess(/symbol|code|ticker/i))}
            instruments={instruments}
          />
        )}
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

const instrumentLabel = (i: Instrument) => `${i.symbol} · ${i.exchange} · ${i.name}`;

/** Names in the instrument column that match nothing yet; mapping one records an alias. */
function UnresolvedNames({ sourceFileId, column, instruments }: { sourceFileId: string; column: string; instruments: Instrument[] }) {
  const queryClient = useQueryClient();
  const fetchUnresolved = useServerFn(listUnresolvedInstruments);
  const unresolved = useQuery({
    queryKey: ['unresolved-instruments', sourceFileId, column],
    queryFn: () => fetchUnresolved({ data: { sourceFileId, column } }),
    enabled: column !== '',
  });
  if (!unresolved.data?.length) return null;
  return (
    <div className="border-line rounded border p-3 sm:col-span-2">
      <p className="mb-2 text-xs">
        <span className="text-warning">
          {unresolved.data.length === 1 ? '1 name matches' : `${unresolved.data.length} names match`} no instrument.
        </span>{' '}
        <span className="text-muted">Map each to an instrument (remembered as an alias), or leave it and its rows are rejected.</span>
      </p>
      {unresolved.data.map((u) => (
        <MapName
          key={u.name}
          name={u.name}
          rows={u.rows}
          instruments={instruments}
          onMapped={() =>
            queryClient.invalidateQueries({ queryKey: ['unresolved-instruments'] }).then(() => queryClient.invalidateQueries(aliasesQuery))
          }
        />
      ))}
    </div>
  );
}

function MapName(props: { name: string; rows: number; instruments: Instrument[]; onMapped: () => void }) {
  const add = useServerFn(addAlias);
  const [instrumentId, setInstrumentId] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2 py-1 text-sm">
      <span className="w-32 font-medium break-all">{props.name}</span>
      <span className="text-muted w-16 text-xs">{props.rows} rows</span>
      <select
        value={instrumentId}
        onChange={(e) => setInstrumentId(e.target.value)}
        className={`${select} min-w-0 flex-1`}
        aria-label={`Instrument for ${props.name}`}
      >
        <option value="">Choose an instrument…</option>
        {props.instruments.map((i) => (
          <option key={i.id} value={i.id}>
            {instrumentLabel(i)}
          </option>
        ))}
      </select>
      <Button
        type="button"
        disabled={!instrumentId}
        onClick={() => add({ data: { instrumentId, alias: props.name } }).then(props.onMapped)}
      >
        Map
      </Button>
    </div>
  );
}

function Aliases({ instruments }: { instruments: Instrument[] }) {
  const queryClient = useQueryClient();
  const { data: aliases } = useSuspenseQuery(aliasesQuery);
  const add = useServerFn(addAlias);
  const remove = useServerFn(removeAlias);
  const [alias, setAlias] = useState('');
  const [instrumentId, setInstrumentId] = useState(instruments[0]!.id);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries(aliasesQuery);
  const byId = new Map(instruments.map((i) => [i.id, i]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await add({ data: { instrumentId, alias } });
      setAlias('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-medium">Instrument aliases</h2>
      <p className="text-muted mb-2 text-xs">
        Other names a price CSV may use for an instrument. Symbols, EXCHANGE:SYMBOL and SYMBOL.AX already match without one.
      </p>
      <Card>
        {aliases.length === 0 && <Empty>No aliases yet.</Empty>}
        {aliases.map((a) => {
          const i = byId.get(a.instrumentId);
          return (
            <div key={a.id} className="border-line flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm last:border-0">
              <span className="w-32 font-medium break-all">{a.alias}</span>
              <span className="text-muted flex-1 text-xs">→ {i ? instrumentLabel(i) : 'Unknown instrument'}</span>
              <Button variant="ghost" onClick={() => remove({ data: { id: a.id } }).then(refresh)}>
                Remove
              </Button>
            </div>
          );
        })}
        <form onSubmit={submit} className="border-line flex flex-wrap items-end gap-2 border-t p-4 text-sm">
          <input
            required
            placeholder="Name in the CSV"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className={`${select} w-40`}
            aria-label="Alias"
          />
          <select
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
            className={`${select} min-w-0`}
            aria-label="Instrument"
          >
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {instrumentLabel(i)}
              </option>
            ))}
          </select>
          <Button type="submit">Add alias</Button>
          {error && <span className="text-negative text-xs">{error}</span>}
        </form>
      </Card>
    </section>
  );
}

type PriceFile = Awaited<ReturnType<typeof listPriceFiles>>[number];

function PriceFileRow({ file, onMap, onChange }: { file: PriceFile; onMap: () => void; onChange: () => void }) {
  const del = useServerFn(deletePriceFile);
  const restore = useServerFn(restorePriceFile);
  const running = file.job?.status === 'queued' || file.job?.status === 'running';
  const progress = useJobProgress(file.job?.id, running, onChange);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = file.summary;

  const act = (fn: () => Promise<unknown>) => {
    setError(null);
    fn()
      .then(onChange)
      .catch((err) => setError(err instanceof Error ? err.message : 'Something went wrong'));
  };

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
            <Button onClick={() => act(() => restore({ data: { id: file.id } }))}>Restore</Button>
          ) : (
            <Button variant="ghost" onClick={() => act(() => del({ data: { id: file.id } }))}>
              Delete
            </Button>
          )}
        </div>
      </div>
      {error && <div className="text-negative mt-1 text-xs">{error}</div>}
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
