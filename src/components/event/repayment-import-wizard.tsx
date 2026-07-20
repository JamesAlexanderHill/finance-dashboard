import * as React from 'react'
import { createServerFn } from '@tanstack/react-start'
import { parseCanonicalCsv } from '~/importers/canonical'
import type { ParsedEvent } from '~/importers/canonical'
import { PARSER_OPTIONS, DEFAULT_PARSER_ID } from '~/importers/parser-options'
import type { ParserId } from '~/importers/parser-options'
import { accountService, repaymentImportService, getSession } from '~/db/services'
import type { InstrumentDraft, RepaymentImportResult } from '~/db/services'
import {
  getAccountInstruments,
  doParseFile,
  fileToBase64,
  InstrumentReview,
  Step1,
  Step3,
  Step4,
} from '~/components/ImportWizard'

// ─── Server functions ─────────────────────────────────────────────────────────

const getCreditAccounts = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { excludeAccountId: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return []
    return accountService.listCredit(session.ctx, data.excludeAccountId)
  })

const doCommitRepaymentImport = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: unknown) =>
      data as {
        parentEventId: string
        accountId: string
        parserId?: string
        filename: string
        events: ParsedEvent[]
        instrumentDrafts: InstrumentDraft[]
        categoryAssignments: Record<string, string | null>
        restoreDeletedChosen: boolean
        rawContent?: { base64: string; contentType: string } | null
      },
  )
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    return repaymentImportService.commit(session.ctx, data)
  })

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5

interface CreditAccountOption {
  id: string
  name: string
}

interface WizardState {
  step: WizardStep
  accountId: string
  parserId: ParserId
  filename: string
  rawFile: File | null
  parsedEvents: ParsedEvent[]
  parseErrors: Array<{ line: number; message: string }>
  instrumentDrafts: InstrumentDraft[]
  categoryAssignments: Record<string, string | null>
  restoreDeletedChosen: boolean
  committing: boolean
  result: RepaymentImportResult | null
}

const EMPTY_WIZARD: WizardState = {
  step: 0,
  accountId: '',
  parserId: DEFAULT_PARSER_ID,
  filename: '',
  rawFile: null,
  parsedEvents: [],
  parseErrors: [],
  instrumentDrafts: [],
  categoryAssignments: {},
  restoreDeletedChosen: false,
  committing: false,
  result: null,
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RepaymentImportWizardProps {
  parentEvent: { id: string; description: string; accountId: string }
  onClose: () => void
  onSuccess: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Imports a credit account's statement directly against a repayment event:
 * every imported transaction becomes a sub-event of `parentEvent`, except
 * the one that looks like the repayment's own transfer counterpart (linked
 * as a `transfer` relation instead). See `repaymentImportService.commit`.
 */
export function RepaymentImportWizard({ parentEvent, onClose, onSuccess }: RepaymentImportWizardProps) {
  const [wizard, setWizard] = React.useState<WizardState>(EMPTY_WIZARD)
  const [creditAccounts, setCreditAccounts] = React.useState<CreditAccountOption[] | null>(null)

  React.useEffect(() => {
    getCreditAccounts({ data: { excludeAccountId: parentEvent.accountId } }).then(setCreditAccounts)
  }, [parentEvent.accountId])

  const selectedAccount = creditAccounts?.find((a) => a.id === wizard.accountId) ?? null

  // ── Step 1: file selection + parse ──────────────────────────────────────────
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const option = PARSER_OPTIONS.find((o) => o.id === wizard.parserId)
    let result: ReturnType<typeof parseCanonicalCsv>
    let rawFile: File | null = null

    if (option?.kind === 'pdf') {
      const parsed = await doParseFile({
        data: { parserId: wizard.parserId, filename: file.name, contentBase64: await fileToBase64(file) },
      })
      if (parsed.error || parsed.canonicalCsv == null) {
        setWizard((w) => ({ ...w, parseErrors: [{ line: 0, message: parsed.error ?? 'Failed to parse file' }] }))
        return
      }
      result = parseCanonicalCsv(parsed.canonicalCsv)
      rawFile = file
    } else {
      result = parseCanonicalCsv(await file.text())
    }

    if (result.errors.length > 0 && result.events.length === 0) {
      setWizard((w) => ({ ...w, parseErrors: result.errors }))
      return
    }

    const existingInstruments = await getAccountInstruments({ data: { accountId: wizard.accountId } })
    const existingByTicker = new Map(existingInstruments.map((i) => [i.ticker.toUpperCase(), i]))

    const requiredTickers = new Set<string>()
    for (const ev of result.events) {
      for (const leg of ev.legs) requiredTickers.add(leg.instrumentCode.toUpperCase())
    }

    const drafts: InstrumentDraft[] = Array.from(requiredTickers).map((ticker) => {
      const existing = existingByTicker.get(ticker)
      if (existing) {
        return { ticker, name: existing.name, exponent: existing.exponent, existingId: existing.id }
      }
      return { ticker, name: ticker, exponent: 2 }
    })

    setWizard((w) => ({
      ...w,
      step: 2,
      filename: file.name,
      rawFile,
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
      const rawContent = wizard.rawFile
        ? { base64: await fileToBase64(wizard.rawFile), contentType: wizard.rawFile.type || 'application/pdf' }
        : null
      const result = await doCommitRepaymentImport({
        data: {
          parentEventId: parentEvent.id,
          accountId: wizard.accountId,
          parserId: wizard.parserId,
          filename: wizard.filename,
          events: wizard.parsedEvents,
          instrumentDrafts: wizard.instrumentDrafts,
          categoryAssignments: wizard.categoryAssignments,
          restoreDeletedChosen: wizard.restoreDeletedChosen,
          rawContent,
        },
      })
      setWizard((w) => ({ ...w, committing: false, step: 5, result }))
    } catch (err) {
      setWizard((w) => ({ ...w, committing: false }))
      alert(`Import failed: ${String(err)}`)
    }
  }

  const STEP_LABELS = ['Account', 'Select file', 'Instruments', 'Review', 'Commit', 'Done']

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          {([0, 1, 2, 3, 4, 5] as const).map((s) => (
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
              {s + 1}. {STEP_LABELS[s]}
            </span>
          ))}
        </div>
        <button onClick={onClose} className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          Cancel
        </button>
      </div>

      <div className="p-5 bg-white dark:bg-gray-900">
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
          Importing a statement against: <span className="text-gray-700 dark:text-gray-300">{parentEvent.description}</span>
        </p>

        {/* Step 0: choose credit account */}
        {wizard.step === 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Step 1 — Which credit account is this statement for?
            </h3>

            {creditAccounts === null && (
              <p className="text-sm text-gray-400 dark:text-gray-500">Loading accounts…</p>
            )}
            {creditAccounts?.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No credit accounts found. Mark an account as a credit account (card or line of credit) in
                its settings first.
              </p>
            )}

            <div className="space-y-2">
              {creditAccounts?.map((a) => (
                <label
                  key={a.id}
                  className={[
                    'flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer',
                    wizard.accountId === a.id
                      ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="creditAccount"
                    checked={wizard.accountId === a.id}
                    onChange={() => setWizard((w) => ({ ...w, accountId: a.id }))}
                  />
                  <span className="text-sm text-gray-900 dark:text-gray-100">{a.name}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={() => setWizard((w) => ({ ...w, step: 1 }))}
                disabled={!wizard.accountId}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 1 (file select) */}
        {wizard.step === 1 && (
          <Step1
            accountName={selectedAccount?.name ?? ''}
            parserId={wizard.parserId}
            parseErrors={wizard.parseErrors}
            onParserChange={(id) => setWizard((w) => ({ ...w, parserId: id, parseErrors: [] }))}
            onFileSelect={handleFileSelect}
          />
        )}

        {/* Step 2 (instruments) */}
        {wizard.step === 2 && (
          <InstrumentReview
            drafts={wizard.instrumentDrafts}
            onChange={(drafts) => setWizard((w) => ({ ...w, instrumentDrafts: drafts }))}
            onBack={() => setWizard((w) => ({ ...w, step: 1 }))}
            onNext={() => setWizard((w) => ({ ...w, step: 3 }))}
          />
        )}

        {/* Step 3 (review) */}
        {wizard.step === 3 && (
          <Step3
            events={wizard.parsedEvents}
            instrumentDrafts={wizard.instrumentDrafts}
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

        {/* Step 4 (commit) */}
        {wizard.step === 4 && (
          <Step4
            wizard={wizard}
            accountName={selectedAccount?.name ?? ''}
            onBack={() => setWizard((w) => ({ ...w, step: 3 }))}
            onCommit={handleCommit}
          />
        )}

        {/* Step 5 (result) */}
        {wizard.step === 5 && wizard.result && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Import complete</h3>

            <div className="grid grid-cols-4 gap-3 text-sm">
              <Stat label="Imported" value={wizard.result.importedCount} />
              <Stat label="Skipped" value={wizard.result.skippedCount} />
              <Stat label="Restored" value={wizard.result.restoredCount} />
              <Stat label="Errors" value={wizard.result.errorCount} highlight={wizard.result.errorCount > 0} />
            </div>

            {wizard.result.transferMatchId ? (
              <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-3 text-sm text-green-700 dark:text-green-300">
                Linked as transfer: "{wizard.result.transferMatchDescription}"
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-300">
                No matching transfer counterpart was found among the imported transactions — link it
                manually from the drawer if one should exist.
              </div>
            )}

            <p className="text-sm text-gray-600 dark:text-gray-400">
              {wizard.result.subEventChildIds.length} transaction
              {wizard.result.subEventChildIds.length !== 1 ? 's' : ''} linked as sub-events of "
              {parentEvent.description}".
            </p>

            <div className="flex gap-2 pt-2">
              <button
                onClick={onSuccess}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">{label}</p>
      <p
        className={[
          'font-medium tabular-nums',
          highlight ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  )
}
