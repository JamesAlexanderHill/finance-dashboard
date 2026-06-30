import * as React from 'react'
import { createServerFn } from '@tanstack/react-start'
import { parseCanonicalCsv } from '~/importers/canonical'
import type { ParseError, ParsedEvent } from '~/importers/canonical'
import { PARSER_OPTIONS, DEFAULT_PARSER_ID } from '~/importers/parser-options'
import type { ParserId } from '~/importers/parser-options'
import { importService, getSession } from '~/db/services'
import type { CommitBulkImportParams, FileImportResult, InstrumentDraft } from '~/db/services'
import { getAccountInstruments, InstrumentReview, doParseFile, fileToBase64 } from '~/components/ImportWizard'

// ─── Server functions ─────────────────────────────────────────────────────────

export const doCommitBulkImport = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as CommitBulkImportParams)
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    return importService.commitBulkImport(session.ctx, data)
  })

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4

interface ParsedFile {
  filename: string
  events: ParsedEvent[]
  errors: ParseError[]
  /** Raw uploaded file kept for storage at commit (PDF parsers only). */
  rawFile: File | null
}

interface WizardState {
  step: WizardStep
  parserId: ParserId
  parsedFiles: ParsedFile[]
  instrumentDrafts: InstrumentDraft[]
  restoreDeletedChosen: boolean
  committing: boolean
  results: FileImportResult[] | null
}

const EMPTY_WIZARD: WizardState = {
  step: 1,
  parserId: DEFAULT_PARSER_ID,
  parsedFiles: [],
  instrumentDrafts: [],
  restoreDeletedChosen: false,
  committing: false,
  results: null,
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BulkImportWizardProps {
  accountId: string
  accountName: string
  onClose: () => void
  onSuccess: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BulkImportWizard({ accountId, accountName, onClose, onSuccess }: BulkImportWizardProps) {
  const [wizard, setWizard] = React.useState<WizardState>(EMPTY_WIZARD)

  // ── Step 1: file selection + parse ──────────────────────────────────────────
  async function handleFilesSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    const option = PARSER_OPTIONS.find((o) => o.id === wizard.parserId)
    const parsedFiles: ParsedFile[] = []
    for (const file of Array.from(fileList)) {
      if (option?.kind === 'pdf') {
        const parsed = await doParseFile({
          data: { parserId: wizard.parserId, filename: file.name, contentBase64: await fileToBase64(file) },
        })
        if (parsed.error || parsed.canonicalCsv == null) {
          parsedFiles.push({
            filename: file.name,
            events: [],
            errors: [{ line: 0, message: parsed.error ?? 'Failed to parse file' }],
            rawFile: null,
          })
          continue
        }
        const result = parseCanonicalCsv(parsed.canonicalCsv)
        parsedFiles.push({ filename: file.name, events: result.events, errors: result.errors, rawFile: file })
      } else {
        const result = parseCanonicalCsv(await file.text())
        parsedFiles.push({ filename: file.name, events: result.events, errors: result.errors, rawFile: null })
      }
    }
    parsedFiles.sort((a, b) => a.filename.localeCompare(b.filename))

    const existingInstruments = await getAccountInstruments({ data: { accountId } })
    const existingByTicker = new Map(existingInstruments.map((i) => [i.ticker.toUpperCase(), i]))

    const requiredTickers = new Set<string>()
    for (const pf of parsedFiles) {
      for (const ev of pf.events) {
        for (const leg of ev.legs) requiredTickers.add(leg.instrumentCode.toUpperCase())
      }
    }

    const drafts: InstrumentDraft[] = Array.from(requiredTickers).map((ticker) => {
      const existing = existingByTicker.get(ticker)
      if (existing) {
        return { ticker, name: existing.name, exponent: existing.exponent, existingId: existing.id }
      }
      return { ticker, name: ticker, exponent: 2 }
    })

    setWizard((w) => ({ ...w, step: 2, parsedFiles, instrumentDrafts: drafts }))
  }

  // ── Step 4: commit ──────────────────────────────────────────────────────────
  async function handleCommit() {
    setWizard((w) => ({ ...w, committing: true }))
    try {
      const files = await Promise.all(
        wizard.parsedFiles
          .filter((f) => f.events.length > 0)
          .map(async (f) => ({
            filename: f.filename,
            events: f.events,
            parserId: wizard.parserId,
            rawContent: f.rawFile
              ? { base64: await fileToBase64(f.rawFile), contentType: f.rawFile.type || 'application/pdf' }
              : null,
          })),
      )
      const results = await doCommitBulkImport({
        data: {
          accountId,
          instrumentDrafts: wizard.instrumentDrafts,
          restoreDeletedChosen: wizard.restoreDeletedChosen,
          files,
        },
      })
      setWizard((w) => ({ ...w, committing: false, results }))
      onSuccess()
    } catch (err) {
      setWizard((w) => ({ ...w, committing: false }))
      alert(`Bulk import failed: ${String(err)}`)
    }
  }

  const filesWithEvents = wizard.parsedFiles.filter((f) => f.events.length > 0)
  const filesWithErrors = wizard.parsedFiles.filter((f) => f.errors.length > 0)
  const totalEvents = filesWithEvents.reduce((sum, f) => sum + f.events.length, 0)
  const selectedOption = PARSER_OPTIONS.find((o) => o.id === wizard.parserId) ?? PARSER_OPTIONS[0]

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
              {s}. {['Select files', 'Instruments', 'Review', 'Commit'][s - 1]}
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
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Step 1 — Select files for {accountName}
            </h3>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Parser
              </label>
              <select
                value={wizard.parserId}
                onChange={(e) => setWizard((w) => ({ ...w, parserId: e.target.value as ParserId }))}
                className="text-sm border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {PARSER_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{selectedOption.description}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Files
              </label>
              <input
                type="file"
                accept={selectedOption.accept}
                multiple
                onChange={handleFilesSelect}
                className="text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 dark:file:bg-blue-950 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100"
              />
            </div>

            <div className="text-xs text-gray-400 dark:text-gray-500 pt-2">
              One parser applies to all selected files. Each file is committed as a separate import
              run, sharing one instrument review step.
            </div>
          </div>
        )}

        {/* Step 2 */}
        {wizard.step === 2 && (
          <InstrumentReview
            drafts={wizard.instrumentDrafts}
            onChange={(drafts) => setWizard((w) => ({ ...w, instrumentDrafts: drafts }))}
            onBack={() => setWizard((w) => ({ ...w, step: 1 }))}
            onNext={() => setWizard((w) => ({ ...w, step: 3 }))}
          />
        )}

        {/* Step 3 */}
        {wizard.step === 3 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Step 3 — Review files ({filesWithEvents.length} of {wizard.parsedFiles.length})
            </h3>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="bulkRestoreDeleted"
                checked={wizard.restoreDeletedChosen}
                onChange={(e) => setWizard((w) => ({ ...w, restoreDeletedChosen: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="bulkRestoreDeleted" className="text-sm text-gray-700 dark:text-gray-300">
                Restore soft-deleted duplicates
              </label>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[40vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-gray-400">File</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Events</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {wizard.parsedFiles.map((f) => (
                    <tr key={f.filename}>
                      <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100">{f.filename}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {f.events.length}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {f.errors.length > 0 ? (
                          <span className="text-red-600 dark:text-red-400">{f.errors.length}</span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filesWithErrors.length > 0 && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3">
                <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-2">
                  {filesWithErrors.length} file{filesWithErrors.length !== 1 ? 's' : ''} had parse errors
                </p>
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {filesWithErrors.flatMap((f) =>
                    f.errors.map((e, i) => (
                      <li key={`${f.filename}-${i}`} className="text-xs text-red-600 dark:text-red-400">
                        {f.filename} line {e.line}: {e.message}
                      </li>
                    )),
                  )}
                </ul>
              </div>
            )}

            <p className="text-sm text-gray-600 dark:text-gray-400">
              {totalEvents} event{totalEvents !== 1 ? 's' : ''} across {filesWithEvents.length} file
              {filesWithEvents.length !== 1 ? 's' : ''} will be imported.
            </p>

            <WizardNav
              onBack={() => setWizard((w) => ({ ...w, step: 2 }))}
              onNext={() => setWizard((w) => ({ ...w, step: 4 }))}
              nextLabel="Proceed to commit"
              nextDisabled={filesWithEvents.length === 0}
            />
          </div>
        )}

        {/* Step 4 */}
        {wizard.step === 4 && (
          <Step4
            wizard={wizard}
            accountName={accountName}
            filesWithEvents={filesWithEvents}
            totalEvents={totalEvents}
            onBack={() => setWizard((w) => ({ ...w, step: 3 }))}
            onCommit={handleCommit}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}

// ─── Wizard Steps ─────────────────────────────────────────────────────────────

function Step4({
  wizard,
  accountName,
  filesWithEvents,
  totalEvents,
  onBack,
  onCommit,
  onClose,
}: {
  wizard: WizardState
  accountName: string
  filesWithEvents: ParsedFile[]
  totalEvents: number
  onBack: () => void
  onCommit: () => void
  onClose: () => void
}) {
  const newInstruments = wizard.instrumentDrafts.filter((d) => !d.existingId)

  if (wizard.results) {
    const totals = wizard.results.reduce(
      (acc, r) => ({
        imported: acc.imported + r.importedCount,
        skipped: acc.skipped + r.skippedCount,
        restored: acc.restored + r.restoredCount,
        errors: acc.errors + r.errorCount,
      }),
      { imported: 0, skipped: 0, restored: 0, errors: 0 },
    )

    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Import complete</h3>

        <div className="grid grid-cols-4 gap-3 text-sm">
          <Stat label="Imported" value={totals.imported} />
          <Stat label="Skipped" value={totals.skipped} />
          <Stat label="Restored" value={totals.restored} />
          <Stat label="Errors" value={totals.errors} highlight={totals.errors > 0} />
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[40vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-gray-400">File</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Imported</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Skipped</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Restored</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {wizard.results.map((r) => (
                <tr key={r.fileId}>
                  <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100">{r.filename}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{r.importedCount}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{r.skippedCount}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{r.restoredCount}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.errorCount > 0 ? (
                      <span className="text-red-600 dark:text-red-400">{r.errorCount}</span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

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
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Files to import</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">{filesWithEvents.length}</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Events to import</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">{totalEvents}</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">New instruments</p>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {newInstruments.length > 0 ? newInstruments.map((d) => d.ticker).join(', ') : 'None'}
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
