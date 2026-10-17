import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import type { flattenTree } from '../lib/category-tree';
import { money, shortDate } from '../lib/format';
import type { listCategories } from '../server/categories.functions';
import {
  acceptCategorySuggestions,
  findSimilarLegsFor,
  setCategoryForLegs,
  setLegCategory,
  setLegTags,
  type EventLegView,
} from '../server/events.functions';
import { CategoryOptions } from './category-options';
import { Button } from './ui';

export type Category = ReturnType<typeof flattenTree<Awaited<ReturnType<typeof listCategories>>['categories'][number]>>[number];

/** Uncategorised legs with a suggestion (feature 14); suggestions are derived from earlier assignments, never stored. */
export const isSuggested = (leg: EventLegView) => leg.categorisable && !leg.categoryId && !!leg.suggestedCategoryId;

/** Gives the selected legs one category in a single step. It is manual: nothing applies to later imports. */
export function BulkCategorise(props: {
  /** Every leg on the page that can be selected. */
  legs: EventLegView[];
  selected: Set<string>;
  categories: Category[];
  onToggleAll: (ids: string[], on: boolean) => void;
  onDone: (notice?: string) => void;
}) {
  const { legs, selected } = props;
  const queryClient = useQueryClient();
  const apply = useServerFn(setCategoryForLegs);
  const accept = useServerFn(acceptCategorySuggestions);
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = legs.map((l) => l.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const suggestions = legs.filter((l) => selected.has(l.id) && isSuggested(l)).map((l) => l.id);

  const run = async (fn: () => Promise<{ categorised: number }>) => {
    setBusy(true);
    setError(null);
    try {
      const { categorised } = await fn();
      await queryClient.invalidateQueries();
      props.onDone(`Categorised ${categorised} ${categorised === 1 ? 'leg' : 'legs'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not categorise');
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => apply({ data: { legIds: [...selected], categoryId: categoryId === 'none' ? null : categoryId } }));

  return (
    <div className="border-line bg-surface sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-t-lg border-b px-4 py-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={allOn} disabled={ids.length === 0} onChange={(e) => props.onToggleAll(ids, e.target.checked)} />
        {selected.size > 0 ? `${selected.size} ${selected.size === 1 ? 'leg' : 'legs'} selected` : 'Select all legs on this page'}
      </label>
      {selected.size > 0 && (
        <>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="border-line bg-surface min-w-0 rounded border px-2 py-1"
            aria-label="Category for selected"
          >
            <option value="">Choose a category…</option>
            <option value="none">Uncategorised</option>
            <CategoryOptions categories={props.categories} />
          </select>
          <Button variant="primary" disabled={!categoryId || busy} onClick={save}>
            Categorise {selected.size}
          </Button>
          {suggestions.length > 0 && (
            <Button disabled={busy} onClick={() => run(() => accept({ data: { legIds: suggestions } }))}>
              Accept {suggestions.length} {suggestions.length === 1 ? 'suggestion' : 'suggestions'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => props.onDone()}>
            Clear
          </Button>
        </>
      )}
      {error && <span className="text-negative text-xs">{error}</span>}
    </div>
  );
}

/** A leg's category (with its suggestion and similar legs to tick) and tags. */
export function LegCategoryEditor(props: { leg: EventLegView; categories: Category[]; tagNames: Map<string, string> }) {
  const { leg, categories, tagNames } = props;
  const queryClient = useQueryClient();
  const setCategory = useServerFn(setLegCategory);
  const findSimilar = useServerFn(findSimilarLegsFor);
  const setTags = useServerFn(setLegTags);
  const suggestion = isSuggested(leg) ? categories.find((c) => c.id === leg.suggestedCategoryId) : undefined;
  const currentTags = leg.tagIds
    .map((id) => tagNames.get(id))
    .filter(Boolean)
    .join(', ');
  const [tags, setTagsText] = useState(currentTags);
  /** A chosen category waiting on the similar-legs panel; nothing is saved until it is applied. */
  const [pending, setPending] = useState<{ categoryId: string; matches: Matches } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries();

  const choose = async (categoryId: string | null) => {
    setPending(null);
    setNotice(null);
    setError(null);
    try {
      // Line items and Uncategorised save at once; otherwise offer legs like this one first.
      if (categoryId && leg.role !== 'line_item') {
        const matches = await findSimilar({ data: { legId: leg.id, categoryId } });
        if (matches.identical.length + matches.similar.length + matches.categorised.length > 0) {
          setPending({ categoryId, matches });
          return;
        }
      }
      await setCategory({ data: { legId: leg.id, categoryId } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not categorise');
    }
  };

  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
        {leg.categorisable ? (
          <select
            value={pending?.categoryId ?? leg.categoryId ?? ''}
            onChange={(e) => choose(e.target.value || null)}
            className={`border-line bg-surface rounded border px-2 py-1 ${leg.categoryId && !pending ? '' : 'text-warning'}`}
            aria-label={`Category for ${leg.description}`}
          >
            <option value="">Uncategorised</option>
            <CategoryOptions categories={categories} />
          </select>
        ) : (
          <span className="text-muted">Moves money between your accounts; not categorised</span>
        )}
        {pending && <span className="text-warning text-xs">Not saved yet</span>}
        {suggestion && !pending && (
          <span className="text-muted text-xs">
            Suggested: {suggestion.path}{' '}
            <button
              className="hover:text-ink underline"
              // Accepting is choosing the suggested category, so it offers similar legs too.
              onClick={() => choose(suggestion.id)}
            >
              Accept
            </button>
          </span>
        )}
        <input
          value={tags}
          onChange={(e) => setTagsText(e.target.value)}
          onBlur={() => {
            if (tags === currentTags) return;
            const tagNames = tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
            setError(null);
            setTags({ data: { legId: leg.id, tagNames } })
              .then(refresh)
              .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not save tags'));
          }}
          placeholder="Tags, comma separated"
          className="border-line bg-surface min-w-40 rounded border px-2 py-1"
          aria-label={`Tags for ${leg.description}`}
        />
        {notice && (
          <span className="text-muted text-xs" role="status">
            {notice}
          </span>
        )}
        {error && <span className="text-negative text-xs">{error}</span>}
      </span>
      {pending && (
        <SimilarLegs
          legId={leg.id}
          categoryId={pending.categoryId}
          matches={pending.matches}
          categories={categories}
          onCancel={() => setPending(null)}
          onDone={(message) => {
            setPending(null);
            setNotice(message);
          }}
        />
      )}
    </>
  );
}

type Matches = Awaited<ReturnType<typeof findSimilarLegsFor>>;
type Match = Matches['identical'][number];

const SIMILAR_SECTIONS = [
  { key: 'identical', title: 'Identical', hint: 'Same description' },
  { key: 'similar', title: 'Similar', hint: 'Same merchant, different details' },
  { key: 'categorised', title: 'Already categorised', hint: 'Currently in another category' },
] as const;

/**
 * Offers legs like the one just categorised, so ticked ones get the same category in one step.
 * Identical ones start ticked; similar and already-categorised ones must be ticked deliberately. Each
 * leg still gets its own assignment and no rule is stored (feature 14).
 */
function SimilarLegs(props: {
  legId: string;
  categoryId: string;
  matches: Matches;
  categories: Category[];
  onCancel: () => void;
  onDone: (notice: string) => void;
}) {
  const { matches, categories } = props;
  const queryClient = useQueryClient();
  const apply = useServerFn(setCategoryForLegs);
  const [ticked, setTicked] = useState(() => new Set(matches.identical.map((m) => m.legId)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathOf = (id: string | null) => categories.find((c) => c.id === id)?.path;
  const toggle = (rows: Match[], on: boolean) => {
    const next = new Set(ticked);
    for (const r of rows) on ? next.add(r.legId) : next.delete(r.legId);
    setTicked(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { categorised } = await apply({ data: { legIds: [props.legId, ...ticked], categoryId: props.categoryId } });
      await queryClient.invalidateQueries();
      props.onDone(`Categorised ${categorised} ${categorised === 1 ? 'leg' : 'legs'} as ${pathOf(props.categoryId) ?? 'chosen'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not categorise');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-line bg-surface-2 mt-2 basis-full rounded border px-4 py-3 text-sm">
      <p className="mb-2">
        Also give <span className="font-medium">{pathOf(props.categoryId)}</span> to these legs?
      </p>
      {/* The list scrolls inside a capped height, so the question and Apply stay in view. */}
      <div className="border-line -mx-4 mb-3 max-h-64 overflow-y-auto overscroll-contain border-y px-4 pb-2">
        {SIMILAR_SECTIONS.map(({ key, title, hint }) => {
          const rows = matches[key];
          if (rows.length === 0) return null;
          const on = rows.filter((r) => ticked.has(r.legId)).length;
          return (
            <div key={key}>
              <label className="bg-surface-2 sticky top-0 flex items-center gap-2 pt-2 pb-1 font-medium">
                <input
                  type="checkbox"
                  checked={on === rows.length}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && on < rows.length;
                  }}
                  onChange={(e) => toggle(rows, e.target.checked)}
                />
                {title}{' '}
                <span className="text-muted text-xs font-normal">
                  · {hint} · {rows.length}
                </span>
              </label>
              <ul className="space-y-1">
                {rows.map((r) => (
                  <li key={r.legId}>
                    <label className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pl-6">
                      <input
                        type="checkbox"
                        className="-ml-6 self-center"
                        checked={ticked.has(r.legId)}
                        onChange={(e) => toggle([r], e.target.checked)}
                      />
                      <span className="text-muted tabular w-24 shrink-0">{shortDate(r.postedOn)}</span>
                      <span className="min-w-40 flex-1">
                        {r.description} <span className="text-muted text-xs">· {r.accountName}</span>
                        {r.categoryId && <span className="text-muted text-xs"> · now {pathOf(r.categoryId) ?? 'another category'}</span>}
                      </span>
                      <span className={`tabular w-28 text-right ${r.amount.startsWith('-') ? '' : 'text-positive'}`}>
                        {money(r.amount, r.commodity)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {matches.truncated && <p className="text-muted pt-2 text-xs">Showing the most recent matches only.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={save}>
          Apply category to {ticked.size + 1}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={props.onCancel}>
          Cancel
        </Button>
        {error && <span className="text-negative text-xs">{error}</span>}
      </div>
    </div>
  );
}
