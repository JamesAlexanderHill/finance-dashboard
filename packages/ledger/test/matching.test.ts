import { describe, expect, test } from 'bun:test';
import { withOrdinals } from '@finance/domain';
import { planMatches } from '../src';

/** Minimal in-memory model of transactions, sources and statement soft deletion. */
class Store {
  private nextId = 1;
  byFingerprint = new Map<string, string>();
  sources: Array<{ file: string; transactionId: string }> = [];
  deletedFiles = new Set<string>();

  import(file: string, descriptions: string[]) {
    const rows = withOrdinals(descriptions.map((d) => ({ accountId: 'acc', postedOn: '2026-01-01', amount: '-1', description: d }))).map(
      (r, rowIndex) => ({ ...r, rowIndex }),
    );
    const plan = planMatches(rows, this.byFingerprint);
    for (const l of plan.linked) this.sources.push({ file, transactionId: l.transactionId });
    for (const rowIndex of plan.created) {
      const id = `T${this.nextId++}`;
      this.byFingerprint.set(rows[rowIndex]!.fingerprint, id);
      this.sources.push({ file, transactionId: id });
    }
    return plan;
  }

  active() {
    return new Set(this.sources.filter((s) => !this.deletedFiles.has(s.file)).map((s) => s.transactionId));
  }

  idOf(description: string) {
    const [row] = withOrdinals([{ accountId: 'acc', postedOn: '2026-01-01', amount: '-1', description }]);
    return this.byFingerprint.get(row!.fingerprint);
  }
}

describe('PRD required scenario (A/B/C)', () => {
  test('overlap, soft delete and reimport preserve identities', () => {
    const store = new Store();
    store.import('A', ['T1', 'T2', 'T3']);
    store.import('B', ['T2', 'T3', 'T4']);
    expect(store.active().size).toBe(4);

    const ids = { T1: store.idOf('T1'), T2: store.idOf('T2') };

    store.deletedFiles.add('A');
    expect([...store.active()].sort()).toEqual([store.idOf('T2'), store.idOf('T3'), store.idOf('T4')].sort());

    store.deletedFiles.add('B');
    expect(store.active().size).toBe(0);

    const plan = store.import('C', ['T1', 'T2', 'T5']);
    expect(plan.linked.map((l) => l.transactionId)).toEqual([ids.T1!, ids.T2!]);
    expect(plan.created).toHaveLength(1);
    expect(store.active().size).toBe(3);
  });

  test('identical rows pair by ordinal and the surplus becomes new transactions', () => {
    const store = new Store();
    store.import('A', ['Coffee', 'Coffee']);
    const plan = store.import('B', ['Coffee', 'Coffee', 'Coffee']);
    expect(plan.linked).toHaveLength(2);
    expect(plan.created).toHaveLength(1);
    expect(store.byFingerprint.size).toBe(3);
  });

  test('identical rows within one file are never merged', () => {
    const store = new Store();
    const plan = store.import('A', ['Coffee', 'Coffee']);
    expect(plan.created).toHaveLength(2);
  });
});
