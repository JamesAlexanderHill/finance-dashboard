import { describe, expect, test } from 'bun:test'
import {
  suggestSubEventGroup,
  statementWindow,
  STATEMENT_LOOKBACK_DAYS,
  STATEMENT_PERIOD_DAYS,
  type SubEventCandidate,
} from '../sub-event-suggestions'

function ev(id: string, date: string, ...amounts: bigint[]): SubEventCandidate {
  return {
    id,
    effectiveAt: new Date(date),
    legs: amounts.map((unitCount) => ({ unitCount })),
  }
}

const ids = (events: SubEventCandidate[]) => events.map((e) => e.id)

describe('statementWindow', () => {
  test('ends STATEMENT_LOOKBACK_DAYS before the parent date and spans STATEMENT_PERIOD_DAYS', () => {
    const parentDate = new Date('2026-03-05T00:00:00Z')
    const { start, end } = statementWindow(parentDate)
    const DAY_MS = 86_400_000
    expect(end.getTime()).toBe(parentDate.getTime() - STATEMENT_LOOKBACK_DAYS * DAY_MS)
    expect(start.getTime()).toBe(end.getTime() - STATEMENT_PERIOD_DAYS * DAY_MS)
  })
})

describe('suggestSubEventGroup', () => {
  test('keeps only net-outflow candidates', () => {
    const candidates = [
      ev('purchase', '2026-02-01T00:00:00Z', -5000n),
      ev('credit', '2026-02-02T00:00:00Z', 2000n),
      ev('zero', '2026-02-03T00:00:00Z', 1000n, -1000n),
    ]
    const { candidates: result } = suggestSubEventGroup(candidates)
    expect(ids(result)).toEqual(['purchase'])
  })

  test('sorts oldest first', () => {
    const candidates = [
      ev('later', '2026-02-10T00:00:00Z', -1000n),
      ev('earlier', '2026-02-01T00:00:00Z', -2000n),
    ]
    const { candidates: result } = suggestSubEventGroup(candidates)
    expect(ids(result)).toEqual(['earlier', 'later'])
  })

  test('candidateSum reflects the total of the returned (net-outflow) candidates only', () => {
    const candidates = [
      ev('a', '2026-02-01T00:00:00Z', -5000n),
      ev('b', '2026-02-05T00:00:00Z', -3000n),
      ev('credit', '2026-02-06T00:00:00Z', 10000n),
    ]
    const { candidateSum } = suggestSubEventGroup(candidates)
    expect(candidateSum).toBe(-8000n)
  })

  test('nets multi-leg candidates before filtering', () => {
    const candidates = [ev('split', '2026-02-01T00:00:00Z', 2000n, -5000n)] // nets -3000
    const { candidates: result, candidateSum } = suggestSubEventGroup(candidates)
    expect(ids(result)).toEqual(['split'])
    expect(candidateSum).toBe(-3000n)
  })

  test('returns empty for no candidates', () => {
    expect(suggestSubEventGroup([])).toEqual({ candidates: [], candidateSum: 0n })
  })
})
