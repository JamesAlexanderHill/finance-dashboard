import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { postImportSuggestionsService, relationService, subEventService, getSession } from '~/db/services'
import { formatCurrency } from '~/lib/format-currency'
import formatDate from '~/lib/format-date'

// ─── Server functions ─────────────────────────────────────────────────────────

const getPostImportSuggestions = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { eventIds: string[] })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return []
    return postImportSuggestionsService.suggestPostImportLinks(session.ctx, data.eventIds)
  })

const approveGroup = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: unknown) =>
      data as { parentEventId: string; transferCandidateId: string; subEventChildIds: string[] },
  )
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user')
    await relationService.create(session.ctx, {
      parentEventId: data.parentEventId,
      childEventId: data.transferCandidateId,
      relationType: 'transfer',
    })
    if (data.subEventChildIds.length > 0) {
      await subEventService.link(session.ctx, {
        parentEventId: data.parentEventId,
        childEventIds: data.subEventChildIds,
      })
    }
  })

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Post-commit review step: for each just-imported event that looks like a
 * repayment (a net outflow with one unambiguous transfer match), proposes
 * linking that transfer plus the prior statement period's purchases on the
 * paired account as sub-events. Nothing is linked until the user approves or
 * skips each group — mirrors the event drawer's suggest-then-approve pickers.
 */
export function PostImportSuggestions({
  eventIds,
  onDone,
}: {
  eventIds: string[]
  onDone: () => void
}) {
  const { data: groups, isLoading } = useQuery({
    queryKey: ['post-import-suggestions', eventIds],
    queryFn: () => getPostImportSuggestions({ data: { eventIds } }),
    enabled: eventIds.length > 0,
  })

  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [approved, setApproved] = React.useState<Set<string>>(new Set())
  const [selectedByGroup, setSelectedByGroup] = React.useState<Record<string, Set<string>>>({})

  React.useEffect(() => {
    if (!groups) return
    setSelectedByGroup((prev) => {
      const next = { ...prev }
      for (const g of groups) {
        if (!(g.parentEventId in next)) {
          next[g.parentEventId] = new Set(g.subEventCandidates.map((c) => c.id))
        }
      }
      return next
    })
  }, [groups])

  if (isLoading) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Checking for linkable transactions…</p>
  }

  if (eventIds.length === 0 || !groups || groups.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Suggested links</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No repayment-style groupings detected in this import.
        </p>
        <button
          onClick={onDone}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
        >
          Done
        </button>
      </div>
    )
  }

  function toggleExpanded(parentEventId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(parentEventId)) next.delete(parentEventId)
      else next.add(parentEventId)
      return next
    })
  }

  function toggleCandidate(parentEventId: string, candidateId: string) {
    setSelectedByGroup((prev) => {
      const set = new Set(prev[parentEventId] ?? [])
      if (set.has(candidateId)) set.delete(candidateId)
      else set.add(candidateId)
      return { ...prev, [parentEventId]: set }
    })
  }

  async function handleApprove(parentEventId: string, transferCandidateId: string) {
    await approveGroup({
      data: {
        parentEventId,
        transferCandidateId,
        subEventChildIds: [...(selectedByGroup[parentEventId] ?? [])],
      },
    })
    setApproved((prev) => new Set(prev).add(parentEventId))
  }

  const pending = groups.filter((g) => !approved.has(g.parentEventId))

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Suggested links ({pending.length})
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        These imported transactions look like repayments — approve to link the transfer and its
        prior statement's purchases, or skip.
      </p>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {groups.map((g) => {
          if (approved.has(g.parentEventId)) {
            return (
              <div
                key={g.parentEventId}
                className="px-4 py-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-300"
              >
                Linked "{g.parentDescription}" to {selectedByGroup[g.parentEventId]?.size ?? 0} sub-event(s).
              </div>
            )
          }

          const isExpanded = expanded.has(g.parentEventId)
          const selected = selectedByGroup[g.parentEventId] ?? new Set()

          return (
            <div key={g.parentEventId} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => toggleExpanded(g.parentEventId)}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 flex items-center justify-between text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {g.parentDescription} → {g.transferCandidateDescription}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {g.subEventCandidates.length} prior transaction{g.subEventCandidates.length !== 1 ? 's' : ''}
                    {' · sum '}
                    {formatCurrency(g.candidateSum)}
                  </p>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
                  {g.subEventCandidates.map((c) => (
                    <label key={c.id} className="flex items-center gap-3 px-4 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleCandidate(g.parentEventId, c.id)}
                        className="rounded shrink-0"
                      />
                      <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">
                        {c.description}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                        {formatDate(c.effectiveAt)}
                      </span>
                      <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {formatCurrency(c.unitCount)}
                      </span>
                    </label>
                  ))}
                  <div className="px-4 py-3">
                    <button
                      onClick={() => handleApprove(g.parentEventId, g.transferCandidateId)}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={onDone}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
        >
          {pending.length === 0 ? 'Done' : 'Skip remaining / Finish'}
        </button>
      </div>
    </div>
  )
}
