import { describe, expect, test } from 'bun:test';
import { possibleDuplicates, statementCoverage, type TrackedAccountRef } from '../src/accounts';

const tracked: TrackedAccountRef[] = [
  { id: 'loan', name: 'Investment Home Loan', institution: 'Commbank', provider: 'commbank', classification: 'liability' },
  { id: 'card', name: 'Platinum Card', institution: 'American Express', provider: 'amex', classification: 'liability' },
  { id: 'vas', name: 'VAS', institution: 'Vanguard', provider: 'vanguard', classification: 'asset' },
  { id: 'house', name: 'House', institution: 'Manual', provider: 'manual', classification: 'asset' },
];
const ids = (name: string, classification: 'asset' | 'liability') => possibleDuplicates({ name, classification }, tracked).map((a) => a.id);

describe('possible duplicates of a manual account', () => {
  test('matches a distinctive word in the name, institution or provider', () => {
    expect(ids('Amex', 'liability')).toEqual(['card']);
    expect(ids('vas shares', 'asset')).toEqual(['vas']);
    expect(ids('Vanguard super', 'asset')).toEqual(['vas']);
  });

  test('a name of only account-type words matches on any of them', () => {
    expect(ids('Home loan', 'liability')).toEqual(['loan']);
    expect(ids('Car loan', 'liability')).toEqual([]);
    expect(ids('Credit card', 'liability')).toEqual(['card']);
  });

  test('ignores other classifications and other manual accounts', () => {
    expect(ids('Home loan', 'asset')).toEqual([]);
    expect(ids('House', 'asset')).toEqual([]);
  });
});

describe('statement coverage', () => {
  test('no statements cover nothing', () => {
    expect(statementCoverage([])).toEqual({ covered: [], gaps: [] });
  });

  test('statements that run on from each other or overlap merge into one period', () => {
    const periods = [
      { start: '2026-02-01', end: '2026-02-28' },
      { start: '2026-01-01', end: '2026-01-31' },
      { start: '2026-02-15', end: '2026-03-31' },
    ];
    expect(statementCoverage(periods)).toEqual({ covered: [{ start: '2026-01-01', end: '2026-03-31' }], gaps: [] });
  });

  test('a missing statement leaves a gap between the periods either side', () => {
    const periods = [
      { start: '2026-03-01', end: '2026-03-31' },
      { start: '2026-01-01', end: '2026-01-31' },
    ];
    expect(statementCoverage(periods)).toEqual({
      covered: [
        { start: '2026-01-01', end: '2026-01-31' },
        { start: '2026-03-01', end: '2026-03-31' },
      ],
      gaps: [{ start: '2026-02-01', end: '2026-02-28' }],
    });
  });

  test('a statement inside another adds nothing', () => {
    const periods = [
      { start: '2026-01-01', end: '2026-06-30' },
      { start: '2026-02-01', end: '2026-02-28' },
    ];
    expect(statementCoverage(periods).covered).toEqual([{ start: '2026-01-01', end: '2026-06-30' }]);
  });
});
