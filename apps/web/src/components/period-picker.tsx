import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  presetRange,
  RANGE_PRESETS,
  rangeLabel,
  startOfMonth,
  todayIso,
  type DateRange,
  type RangePreset,
} from '@finance/shared';
import { monthYear, shortDate } from '../lib/format';

export type PeriodValue = { preset: RangePreset; range: DateRange } | { preset: 'custom'; range: DateRange };

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const presetLabel = (id: RangePreset) => RANGE_PRESETS.find((p) => p.id === id)!.label;

/**
 * A compact period control: a button naming the period opens a menu of relative ranges beside a
 * two-month calendar for picking exact dates. A preset applies at once; a calendar range on Apply.
 */
export function PeriodPicker({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="border-line bg-surface hover:bg-surface-2 flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
      >
        <CalendarIcon />
        <span className="font-medium">{value.preset === 'custom' ? 'Custom' : presetLabel(value.preset)}</span>
        <span className="text-muted hidden sm:inline">{rangeLabel(value.range)}</span>
        <span className="text-muted" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <Popover
          value={value}
          onPreset={(preset) => {
            onChange({ preset, range: presetRange(preset, todayIso()) });
            setOpen(false);
          }}
          onApply={(range) => {
            onChange({ preset: 'custom', range });
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function Popover({
  value,
  onPreset,
  onApply,
  onCancel,
}: {
  value: PeriodValue;
  onPreset: (p: RangePreset) => void;
  onApply: (r: DateRange) => void;
  onCancel: () => void;
}) {
  const today = todayIso();
  const [draft, setDraft] = useState<{ from: string; to: string | null }>(value.range);
  const [hover, setHover] = useState<string | null>(null);
  // The left-hand month; the right-hand one follows it. Opens with the range's end on the right.
  const [month, setMonth] = useState(() => addMonths(startOfMonth(value.range.to), -1));

  const pick = (day: string) => {
    if (draft.to !== null || day < draft.from) setDraft({ from: day, to: null });
    else setDraft({ from: draft.from, to: day });
  };
  const end = draft.to ?? (hover && hover >= draft.from ? hover : draft.from);

  return (
    <div
      role="dialog"
      aria-label="Choose a period"
      className="border-line bg-surface absolute left-0 z-30 mt-1 flex sm:right-0 sm:left-auto w-[calc(100vw-2rem)] max-w-max flex-col rounded-lg border shadow-lg sm:flex-row"
    >
      <ul className="border-line flex flex-wrap gap-1 border-b p-2 text-sm sm:w-44 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
        {RANGE_PRESETS.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onPreset(p.id)}
              className={`w-full rounded px-2 py-1 text-left whitespace-nowrap ${
                value.preset === p.id ? 'bg-accent text-accent-ink' : 'hover:bg-surface-2'
              }`}
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="p-3">
        <div className="flex gap-6">
          <Month
            month={month}
            from={draft.from}
            to={end}
            today={today}
            onPick={pick}
            onHover={setHover}
            prev={<NavButton label="Previous month" onClick={() => setMonth(addMonths(month, -1))} text="‹" />}
            next={
              <span className="sm:hidden">
                <NavButton label="Next month" onClick={() => setMonth(addMonths(month, 1))} text="›" />
              </span>
            }
          />
          <div className="hidden sm:block">
            <Month
              month={addMonths(month, 1)}
              from={draft.from}
              to={end}
              today={today}
              onPick={pick}
              onHover={setHover}
              next={<NavButton label="Next month" onClick={() => setMonth(addMonths(month, 1))} text="›" />}
            />
          </div>
        </div>
        <div className="border-line mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
          <span className="tabular flex-1">
            {shortDate(draft.from)} – {draft.to ? shortDate(draft.to) : <span className="text-muted">pick an end date</span>}
          </span>
          <button onClick={onCancel} className="text-muted hover:text-ink px-2 py-1">
            Cancel
          </button>
          <button
            onClick={() => draft.to && onApply({ from: draft.from, to: draft.to })}
            disabled={!draft.to}
            className="bg-accent text-accent-ink rounded-md px-3 py-1 font-medium disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function Month({
  month,
  from,
  to,
  today,
  onPick,
  onHover,
  prev,
  next,
}: {
  month: string;
  from: string;
  to: string;
  today: string;
  onPick: (day: string) => void;
  onHover: (day: string | null) => void;
  /** Month navigation shown either side of the title (one month on narrow screens carries both). */
  prev?: ReactNode;
  next?: ReactNode;
}) {
  const last = endOfMonth(month);
  const lead = (new Date(`${month}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const days: string[] = [];
  for (let d = month; d <= last; d = addDays(d, 1)) days.push(d);
  return (
    <div className="w-60">
      <div className="mb-2 flex items-center justify-between text-sm font-medium">
        {prev ?? <span className="w-6" />}
        <span>{monthYear(month)}</span>
        {next ?? <span className="w-6" />}
      </div>
      <div className="text-muted grid grid-cols-7 text-center text-[11px]">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center text-sm" onMouseLeave={() => onHover(null)}>
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {days.map((d) => {
          const future = d > today;
          const edge = d === from || d === to;
          const inside = d > from && d < to;
          return (
            <button
              key={d}
              disabled={future}
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover(d)}
              aria-label={shortDate(d)}
              aria-pressed={edge || inside}
              className={`tabular h-8 disabled:opacity-30 ${
                edge ? 'bg-accent text-accent-ink rounded' : inside ? 'bg-surface-2' : 'hover:bg-surface-2 rounded'
              } ${d === today && !edge ? 'font-semibold underline' : ''}`}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({ label, onClick, text }: { label: string; onClick: () => void; text: string }) {
  return (
    <button onClick={onClick} aria-label={label} className="hover:bg-surface-2 w-6 rounded">
      {text}
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="text-muted">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  );
}
