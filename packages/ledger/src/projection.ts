import { deterministicUuid, isPositive, type DecimalString, type IsoDate } from '@finance/shared';
import {
  currentDecisions,
  decisionKey,
  type CategoryPayload,
  type DecisionRecord,
  type ItemisationPayload,
  type TagsPayload,
} from './decisions';

export type EventType = 'income' | 'expense' | 'refund' | 'opening_balance';
export type LegRole = 'principal' | 'line_item';

export interface ActiveTransaction {
  id: string;
  accountId: string;
  postedOn: IsoDate;
  description: string;
  amount: DecimalString;
  commodity: string;
}

export interface OpeningBalance {
  accountId: string;
  on: IsoDate;
  balance: DecimalString;
  commodity: string;
}

export interface CategoryRef {
  id: string;
  kind: 'income' | 'expense';
}

export interface ProjectedLeg {
  id: string;
  eventId: string;
  accountId: string;
  transactionId: string | null;
  role: LegRole;
  legKey: string;
  occurredOn: IsoDate;
  description: string;
  amount: DecimalString;
  commodity: string;
  categoryId: string | null;
  tagIds: string[];
}

export interface ProjectedEvent {
  id: string;
  type: EventType;
  occurredOn: IsoDate;
  description: string;
  isInternal: boolean;
  governingDecisionId: string | null;
  transactionIds: string[];
  legs: ProjectedLeg[];
}

export interface ProjectionInput {
  transactions: readonly ActiveTransaction[];
  decisions: readonly DecisionRecord[];
  /** Live categories; decisions pointing elsewhere resolve to Uncategorised. */
  categories: readonly CategoryRef[];
  openingBalances: readonly OpeningBalance[];
}

/**
 * Rebuilds events and legs from active canonical transactions plus reconciliation decisions (ADR 0006).
 * Pure and deterministic: the same input always yields the same IDs.
 *
 * Slice 1 has no transfer matching yet, so every transaction is its own income or expense event.
 */
export function projectEvents(input: ProjectionInput): ProjectedEvent[] {
  const decisions = currentDecisions(input.decisions);
  const categories = new Map(input.categories.map((c) => [c.id, c]));
  const events: ProjectedEvent[] = [];

  const categoryFor = (txId: string, legKey: string) => {
    const d = decisions.get(decisionKey(txId, 'category', legKey));
    const id = (d?.payload as CategoryPayload | undefined)?.categoryId ?? null;
    return id && categories.has(id) ? id : null;
  };
  const tagsFor = (txId: string, legKey: string) => {
    const d = decisions.get(decisionKey(txId, 'tags', legKey));
    return [...((d?.payload as TagsPayload | undefined)?.tagIds ?? [])].sort();
  };

  for (const tx of input.transactions) {
    const eventId = deterministicUuid('event', tx.id);
    const itemisation = decisions.get(decisionKey(tx.id, 'itemisation'));
    const lines = (itemisation?.payload as ItemisationPayload | undefined)?.lines ?? null;

    const parts = lines
      ? lines.map((line, i) => ({ legKey: `line:${i}`, role: 'line_item' as const, amount: line.amount, description: line.description || tx.description }))
      : [{ legKey: 'principal', role: 'principal' as const, amount: tx.amount, description: tx.description }];

    const legs = parts.map<ProjectedLeg>((part) => ({
      id: deterministicUuid('leg', eventId, tx.id, part.legKey),
      eventId,
      accountId: tx.accountId,
      transactionId: tx.id,
      role: part.role,
      legKey: part.legKey,
      occurredOn: tx.postedOn,
      description: part.description,
      amount: part.amount,
      commodity: tx.commodity,
      categoryId: categoryFor(tx.id, part.legKey),
      tagIds: tagsFor(tx.id, part.legKey),
    }));

    const inflow = isPositive(tx.amount);
    const expenseCategorised = legs.some((l) => l.categoryId && categories.get(l.categoryId)?.kind === 'expense');
    events.push({
      id: eventId,
      type: inflow ? (expenseCategorised ? 'refund' : 'income') : 'expense',
      occurredOn: tx.postedOn,
      description: tx.description,
      isInternal: false,
      governingDecisionId: null,
      transactionIds: [tx.id],
      legs,
    });
  }

  for (const ob of input.openingBalances) {
    const eventId = deterministicUuid('opening-balance', ob.accountId, ob.on);
    events.push({
      id: eventId,
      type: 'opening_balance',
      occurredOn: ob.on,
      description: 'Opening balance',
      isInternal: false,
      governingDecisionId: null,
      transactionIds: [],
      legs: [
        {
          id: deterministicUuid('leg', eventId, 'opening'),
          eventId,
          accountId: ob.accountId,
          transactionId: null,
          role: 'principal',
          legKey: 'opening',
          occurredOn: ob.on,
          description: 'Opening balance',
          amount: ob.balance,
          commodity: ob.commodity,
          categoryId: null,
          tagIds: [],
        },
      ],
    });
  }

  return events.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id));
}

/** Opening-balance and internal-event principal legs never count as income or expense. */
export function isCashFlowLeg(event: Pick<ProjectedEvent, 'type' | 'isInternal'>, leg: Pick<ProjectedLeg, 'role'>): boolean {
  if (event.type === 'opening_balance') return false;
  if (event.isInternal) return leg.role !== 'principal' && leg.role !== 'line_item';
  return true;
}
