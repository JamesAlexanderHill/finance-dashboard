import * as React from 'react'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { instruments } from '~/db/schema'
import { parseCanonicalCsv } from '~/importers/canonical'
import type { ParsedEvent } from '~/importers/canonical'
import { commitImport } from '~/lib/import-runner'
import type { InstrumentDraft } from '~/lib/import-runner'

// ─── Server functions ─────────────────────────────────────────────────────────

export const getAccountInstruments = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string })
  .handler(async ({ data }) => {
    return db
      .select()
      .from(instruments)
      .where(eq(instruments.accountId, data.accountId))
  })

export const doCommitImport = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as Parameters<typeof commitImport>[0])
  .handler(async ({ data }) => commitImport(data))

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 0 | 1 | 2 | 3 | 4

interface WizardState {
  step: WizardStep
  accountId: string
  filename: string
  parsedEvents: ParsedEvent[]
  parseErrors: Array<{ line: number; message: string }>
  instrumentDrafts: InstrumentDraft[]
  categoryAssignments: Record<string, string | null>
  restoreDeletedChosen: boolean
  committing: boolean
}

const EMPTY_WIZARD: WizardState = {
  step: 0,
  accountId: '',
  filename: '',
  parsedEvents: [],
  parseErrors: [],
  instrumentDrafts: [],
  categoryAssignments: {},
  restoreDeletedChosen: false,
  committing: false,
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ImportWizardProps {
  userId: string
  accountId: string
  accountName: string
  onClose: () => void
  onSuccess: (runId: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportWizard({ userId, accountId, accountName, onClose, onSuccess }: ImportWizardProps) {
  const [wizard, setWizard] = React.useState<WizardState>({
    ...EMPTY_WIZARD,
    step: 1,
    accountId,
  })

  // ── Step 1: file selection + parse ──────────────────────────────────────────
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const text = await file.text()
    const result = parseCanonicalCsv(text)

    if (result.errors.length > 0 && result.events.length === 0) {
      setWizard((w) => ({ ...w, parseErrors: result.errors }))
      return
    }

    // Load existing instruments for the account
    const existingInstruments = await getAccountInstruments({ data: { accountId } })
    const existingByCode = new Map(existingInstruments.map((i) => [i.code.toUpperCase(), i]))

    // Infer required instrument codes from the parsed CSV
    const requiredCodes = new Set<string>()
    for (const ev of result.events) {
      for (const leg of ev.legs) requiredCodes.add(leg.instrumentCode.toUpperCase())
    }

    const drafts: InstrumentDraft[] = Array.from(requiredCodes).map((code) => {
      const existing = existingByCode.get(code)
      if (existing) {
        return { code, name: existing.name, kind: existing.kind, minorUnit: existing.minorUnit, existingId: existing.id }
      }
      return { code, name: code, kind: 'fiat', minorUnit: 2 }
    })

    setWizard((w) => ({
      ...w,
      step: 2,
      filename: file.name,
      parsedEvents: result.events,
      parseErrors: result.errors,
      instrumentDrafts: drafts,
      categoryAssignments: {},
    }))
  }

  // ── Step 4: commit ──────────────────────────────────────────────────────────
  async function handleCommit() {
    setWizard((w) => ({ ...w, committing: true }))
    try {
      const runId = await doCommitImport({
        data: {
          userId,
          accountId: wizard.accountId,
          filename: wizard.filename,
          events: wizard.parsedEvents,
          instrumentDrafts: wizard.instrumentDrafts,
          categoryAssignments: wizard.categoryAssignments,
          restoreDeletedChosen: wizard.restoreDeletedChosen,
        },
      })
      onSuccess(runId)
    } catch (err) {
      setWizard((w) => ({ ...w, committing: false }))
      alert(`Import failed: ${String(err)}`)
    }
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Wizard header */}
      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {([1, 2, 3, 4] as const).map((s) => (
            <span
              key={s}
              className={[
                'text-sm font-medium',
                wizard.step === s
                  ? 'text-blue-600 dark:text-blue-400'
                  : wizard.step > s
                    ? 'text-gray-400 dark:text-gray-500'
                    : 'text-gray-300 dark:text-gray-600',
              ].join(' ')}
            >
              {s}.{' '}
              {['Select file', 'Instruments', 'Review', 'Commit'][s - 1]}
            </span>
          ))}
        </div>
        <button onClick={onClose} className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          Cancel
        </button>
      </div>

      <div className="p-5 bg-white dark:bg-gray-900">
        {/* Step 1 */}
        {wizard.step === 1 && (
          <Step1
            accountName={accountName}
            parseErrors={wizard.parseErrors}
            onFileSelect={handleFileSelect}
          />
        )}

        {/* Step 2 */}
        {wizard.step === 2 && (
          <Step2
            drafts={wizard.instrumentDrafts}
            onChange={(drafts) => setWizard((w) => ({ ...w, instrumentDrafts: drafts }))}
            onBack={() => setWizard((w) => ({ ...w, step: 1 }))}
            onNext={() => setWizard((w) => ({ ...w, step: 3 }))}
          />
        )}

        {/* Step 3 */}
        {wizard.step === 3 && (
          <Step3
            events={wizard.parsedEvents}
            categoryAssignments={wizard.categoryAssignments}
            restoreDeletedChosen={wizard.restoreDeletedChosen}
            onCategoryAssign={(key, path) =>
              setWizard((w) => ({
                ...w,
                categoryAssignments: { ...w.categoryAssignments, [key]: path },
              }))
            }
            onRestoreToggle={(v) => setWizard((w) => ({ ...w, restoreDeletedChosen: v }))}
            onBack={() => setWizard((w) => ({ ...w, step: 2 }))}
            onNext={() => setWizard((w) => ({ ...w, step: 4 }))}
          />
        )}

        {/* Step 4 */}
        {wizard.step === 4 && (
          <Step4
            wizard={wizard}
            accountName={accountName}
            onBack={() => setWizard((w) => ({ ...w, step: 3 }))}
            onCommit={handleCommit}
          />
        )}
      </div>
    </div>
  )
}

// ─── Wizard Steps ─────────────────────────────────────────────────────────────

function Step1({
  accountName,
  parseErrors,
  onFileSelect,
}: {
  accountName: string
  parseErrors: Array<{ line: number; message: string }>
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Step 1 — Select CSV file for {accountName}
      </h3>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          CSV File
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFileSelect}
          className="text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 dark:file:bg-blue-950 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100"
        />
      </div>

      {parseErrors.length > 0 && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3">
          <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-2">
            Validation errors ({parseErrors.length})
          </p>
          <ul className="space-y-1">
            {parseErrors.map((e, i) => (
              <li key={i} className="text-xs text-red-600 dark:text-red-400">
                Line {e.line}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs text-gray-400 dark:text-gray-500 pt-2">
        Expected columns:{' '}
        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
          eventGroup, externalEventId, eventType, effectiveAt, postedAt, description,
          instrumentCode, amountMinor, categoryPath
        </code>
      </div>
    </div>
  )
}

function Step2({
  drafts,
  onChange,
  onBack,
  onNext,
}: {
  drafts: InstrumentDraft[]
  onChange: (drafts: InstrumentDraft[]) => void
  onBack: () => void
  onNext: () => void
}) {
  function update(idx: number, field: keyof InstrumentDraft, value: string | number) {
    onChange(drafts.map((d, i) => (i === idx ? { ...d, [field]: value } : d)))
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Step 2 — Review instruments
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Existing instruments are shown read-only. New instruments will be created on commit.
      </p>

      <div className="space-y-2">
        {drafts.map((draft, idx) => (
          <div
            key={draft.code}
            className={[
              'grid grid-cols-4 gap-3 items-center p-3 rounded-lg border',
              draft.existingId
                ? 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-70'
                : 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800',
            ].join(' ')}
          >
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Code</p>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{draft.code}</p>
              {draft.existingId ? (
                <span className="text-xs text-gray-400 dark:text-gray-500">existing</span>
              ) : (
                <span className="text-xs text-blue-600 dark:text-blue-400">will be created</span>
              )}
            </div>

            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Name</p>
              <input
                disabled={!!draft.existingId}
                value={draft.name}
                onChange={(e) => update(idx, 'name', e.target.value)}
                className="w-full text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-50"
              />
            </div>

            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Kind</p>
              <select
                disabled={!!draft.existingId}
                value={draft.kind}
                onChange={(e) => update(idx, 'kind', e.target.value)}
                className="w-full text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 disabled:opacity-50"
              >
                <option value="fiat">fiat</option>
                <option value="security">security</option>
                <option value="crypto">crypto</option>
                <option value="other">other</option>
              </select>
            </div>

            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Minor Unit</p>
              <input
                type="number"
                min={0}
                max={8}
                disabled={!!draft.existingId}
                value={draft.minorUnit}
                onChange={(e) => update(idx, 'minorUnit', parseInt(e.target.value, 10))}
                className="w-full text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-50"
              />
            </div>
          </div>
        ))}
      </div>

      <WizardNav onBack={onBack} onNext={onNext} nextLabel="Review" />
    </div>
  )
}

function Step3({
  events,
  categoryAssignments,
  restoreDeletedChosen,
  onCategoryAssign,
  onRestoreToggle,
  onBack,
  onNext,
}: {
  events: ParsedEvent[]
  categoryAssignments: Record<string, string | null>
  restoreDeletedChosen: boolean
  onCategoryAssign: (key: string, path: string | null) => void
  onRestoreToggle: (v: boolean) => void
  onBack: () => void
  onNext: () => void
}) {
  const [expandedEvents, setExpandedEvents] = React.useState<Set<string>>(new Set())

  function toggleEvent(eventGroup: string) {
    setExpandedEvents((prev) => {
      const next = new Set(prev)
      if (next.has(eventGroup)) {
        next.delete(eventGroup)
      } else {
        next.add(eventGroup)
      }
      return next
    })
  }

  function expandAll() {
    setExpandedEvents(new Set(events.map((ev) => ev.eventGroup)))
  }

  function collapseAll() {
    setExpandedEvents(new Set())
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Step 3 — Review events ({events.length})
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Expand all
          </button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <button
            type="button"
            onClick={collapseAll}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Collapse all
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="restoreDeleted"
          checked={restoreDeletedChosen}
          onChange={(e) => onRestoreToggle(e.target.checked)}
          className="rounded"
        />
        <label htmlFor="restoreDeleted" className="text-sm text-gray-700 dark:text-gray-300">
          Restore soft-deleted duplicates
        </label>
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {events.map((ev) => {
          const isExpanded = expandedEvents.has(ev.eventGroup)
          return (
            <div
              key={ev.eventGroup}
              className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
            >
              {/* Event header - clickable accordion trigger */}
              <button
                type="button"
                onClick={() => toggleEvent(ev.eventGroup)}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 flex items-center justify-between text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {ev.description}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {ev.effectiveAt.toLocaleDateString('en-AU')} · {ev.eventType} · {ev.legs.length} leg{ev.legs.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-3">
                  {/* Leg summary badges */}
                  <div className="flex gap-1.5">
                    {ev.legs.slice(0, 3).map((leg, idx) => {
                      const neg = leg.amountMinor < BigInt(0)
                      const abs = neg ? -leg.amountMinor : leg.amountMinor
                      return (
                        <span
                          key={idx}
                          className={[
                            'text-xs tabular-nums px-1.5 py-0.5 rounded',
                            neg
                              ? 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300'
                              : 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300',
                          ].join(' ')}
                        >
                          {neg ? '−' : '+'}{abs.toString()} {leg.instrumentCode}
                        </span>
                      )
                    })}
                    {ev.legs.length > 3 && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        +{ev.legs.length - 3} more
                      </span>
                    )}
                  </div>
                  {/* Chevron */}
                  <svg
                    className={[
                      'w-4 h-4 text-gray-400 transition-transform',
                      isExpanded ? 'rotate-180' : '',
                    ].join(' ')}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Legs - shown when expanded */}
              {isExpanded && (
                <div className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
                  {ev.legs.map((leg, legIdx) => (
                    <div key={legIdx} className="px-4 py-2 flex items-center gap-3">
                      <span
                        className={[
                          'text-sm tabular-nums w-32 flex-shrink-0',
                          leg.amountMinor < BigInt(0)
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-green-700 dark:text-green-400',
                        ].join(' ')}
                      >
                        {leg.amountMinor < BigInt(0) ? '−' : '+'}
                        {(leg.amountMinor < BigInt(0) ? -leg.amountMinor : leg.amountMinor).toString()}{' '}
                        {leg.instrumentCode}
                      </span>

                      {/* Category path input */}
                      <input
                        type="text"
                        placeholder="category path (e.g. food:coffee)"
                        defaultValue={
                          categoryAssignments[`${ev.eventGroup}_${legIdx}`] ??
                          leg.categoryPath ??
                          ''
                        }
                        onBlur={(e) =>
                          onCategoryAssign(`${ev.eventGroup}_${legIdx}`, e.target.value || null)
                        }
                        className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <WizardNav onBack={onBack} onNext={onNext} nextLabel="Proceed to commit" />
    </div>
  )
}

function Step4({
  wizard,
  accountName,
  onBack,
  onCommit,
}: {
  wizard: WizardState
  accountName: string
  onBack: () => void
  onCommit: () => void
}) {
  const newInstruments = wizard.instrumentDrafts.filter((d) => !d.existingId)

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Step 4 — Confirm and import
      </h3>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Account</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">{accountName}</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">File</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">{wizard.filename}</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Events to import</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">{wizard.parsedEvents.length}</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">New instruments</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {newInstruments.length > 0 ? newInstruments.map((d) => d.code).join(', ') : 'None'}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Restore deleted</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {wizard.restoreDeletedChosen ? 'Yes' : 'No'}
          </p>
        </div>
      </div>

      <WizardNav
        onBack={onBack}
        onNext={onCommit}
        nextLabel={wizard.committing ? 'Importing...' : 'Import'}
        nextDisabled={wizard.committing}
        nextClassName="bg-green-600 hover:bg-green-700"
      />
    </div>
  )
}

function WizardNav({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  nextClassName,
}: {
  onBack: () => void
  onNext: () => void
  nextLabel: string
  nextDisabled?: boolean
  nextClassName?: string
}) {
  return (
    <div className="flex gap-2 pt-2">
      <button
        onClick={onBack}
        className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-md"
      >
        Back
      </button>
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className={[
          'px-4 py-1.5 text-sm font-medium text-white rounded-md disabled:opacity-50 transition-colors',
          nextClassName ?? 'bg-blue-600 hover:bg-blue-700',
        ].join(' ')}
      >
        {nextLabel}
      </button>
    </div>
  )
}
