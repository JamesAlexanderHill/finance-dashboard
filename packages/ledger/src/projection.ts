import { abs, cmp, isNegative, isPositive, type DecimalString, type IsoDate } from '@finance/shared';
import { deterministicUuid } from '@finance/shared/node';
import {
  currentDecisions,
  decisionKey,
  type CategoryPayload,
  type DecisionRecord,
  type ItemisationPayload,
  type LinkPayload,
  type TagsPayload,
  type TransferPayload,
} from './decisions';

export type EventType =
  'income' | 'expense' | 'refund' | 'internal_transfer' | 'currency_conversion' | 'investment_buy' | 'investment_sell' | 'opening_balance';
export type EventStatus = 'ok' | 'unmatched_transfer';
export type LegRole = 'principal' | 'fee' | 'line_item';

export interface ActiveTransaction {
  id: string;
  accountId: string;
  postedOn: IsoDate;
  description: string;
  amount: DecimalString;
  commodity: string;
  /** `instrument` for holding accounts, whose amounts are quantities. */
  commodityKind: 'currency' | 'instrument';
  role: 'principal' | 'fee';
  /** Provider reference grouping rows of one activity, e.g. `wise:BALANCE-1`. */
  providerGroupRef: string | null;
  isTransferHint: boolean;
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
  status: EventStatus;
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

/** Leg identity within a transaction; category and tag decisions are keyed on it. */
export const legKeyFor = (role: 'principal' | 'fee') => (role === 'fee' ? 'fee' : 'principal');

/** Groups transactions that share a provider reference or a current link group (union-find). */
function components(transactions: readonly ActiveTransaction[], linkGroupOf: (txId: string) => string | null) {
  const parent = new Map(transactions.map((t) => [t.id, t.id]));
  const find = (id: string): string => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const firstByKey = new Map<string, string>();
  const join = (key: string, id: string) => {
    const other = firstByKey.get(key);
    if (other) parent.set(find(id), find(other));
    else firstByKey.set(key, id);
  };
  for (const t of transactions) {
    if (t.providerGroupRef) join(`ref:${t.providerGroupRef}`, t.id);
    const group = linkGroupOf(t.id);
    if (group) join(`link:${group}`, t.id);
  }
  const groups = new Map<string, ActiveTransaction[]>();
  for (const t of transactions) groups.set(find(t.id), [...(groups.get(find(t.id)) ?? []), t]);
  return [...groups.values()];
}

/**
 * Rebuilds events and legs from active canonical transactions plus reconciliation decisions (ADR 0006).
 * Pure and deterministic: the same input always yields the same IDs.
 *
 * Transactions sharing a provider reference (a Wise conversion and its fee) or a link decision (both
 * halves of a transfer) form one event. Events moving value both into and out of owned accounts are
 * internal: an investment buy/sell when units of an instrument move, a conversion when currencies
 * differ, otherwise a transfer. A lone transfer whose counterpart is
 * missing is an unmatched transfer. Internal principal legs are never categorised.
 */
export function projectEvents(input: ProjectionInput): ProjectedEvent[] {
  const decisions = currentDecisions(input.decisions);
  const categories = new Map(input.categories.map((c) => [c.id, c]));
  const events: ProjectedEvent[] = [];

  const payload = <T>(txId: string, kind: DecisionRecord['kind'], legKey = '') =>
    decisions.get(decisionKey(txId, kind, legKey))?.payload as T | undefined;
  const linkGroupOf = (txId: string) => payload<LinkPayload>(txId, 'link')?.groupId ?? null;
  const categoryFor = (txId: string, legKey: string) => {
    const id = payload<CategoryPayload>(txId, 'category', legKey)?.categoryId ?? null;
    return id && categories.has(id) ? id : null;
  };
  const tagsFor = (txId: string, legKey: string) => [...(payload<TagsPayload>(txId, 'tags', legKey)?.tagIds ?? [])].sort();

  for (const members of components(input.transactions, linkGroupOf)) {
    const ids = members.map((t) => t.id).sort();
    const linkGroups = [...new Set(members.map((t) => linkGroupOf(t.id)).filter((g): g is string => !!g))].sort();
    const eventId = deterministicUuid('event', ...ids, ...linkGroups);

    const legs = members.flatMap((tx) => {
      const lines = tx.role === 'principal' ? (payload<ItemisationPayload>(tx.id, 'itemisation')?.lines ?? null) : null;
      const parts = lines
        ? lines.map((line, i) => ({
            legKey: `line:${i}`,
            role: 'line_item' as const,
            amount: line.amount,
            description: line.description || tx.description,
          }))
        : [{ legKey: legKeyFor(tx.role), role: tx.role, amount: tx.amount, description: tx.description }];
      return parts.map<ProjectedLeg>((part) => ({
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
    });

    const principals = members.filter((t) => t.role === 'principal');
    const hasIn = principals.some((t) => isPositive(t.amount));
    const hasOut = principals.some((t) => isNegative(t.amount));
    const single = members.length === 1 ? members[0]! : null;
    const markedTransfer = single
      ? (payload<TransferPayload>(single.id, 'transfer')?.isTransfer ?? single.isTransferHint) || linkGroups.length > 0
      : false;

    let type: EventType;
    let status: EventStatus = 'ok';
    let isInternal = false;
    if (markedTransfer) {
      // A lone transfer (hinted, marked, or whose linked counterpart is no longer active).
      type = 'internal_transfer';
      status = 'unmatched_transfer';
      isInternal = true;
    } else if (hasIn && hasOut) {
      // Units in → a buy; units out → a sell; otherwise currencies changed hands or money moved.
      const units = principals.filter((t) => t.commodityKind === 'instrument');
      type = units.length
        ? units.some((t) => isPositive(t.amount))
          ? 'investment_buy'
          : 'investment_sell'
        : new Set(principals.map((t) => t.commodity)).size > 1
          ? 'currency_conversion'
          : 'internal_transfer';
      isInternal = true;
    } else if (hasIn) {
      const expenseCategorised = legs.some((l) => l.role !== 'fee' && l.categoryId && categories.get(l.categoryId)?.kind === 'expense');
      type = expenseCategorised ? 'refund' : 'income';
    } else {
      type = 'expense';
    }
    if (isInternal) for (const leg of legs) if (leg.role !== 'fee') leg.categoryId = null;

    const lead = [...(principals.length ? principals : members)].sort(
      (a, b) => cmp(abs(b.amount), abs(a.amount)) || a.id.localeCompare(b.id),
    )[0]!;
    events.push({
      id: eventId,
      type,
      status,
      occurredOn: members.map((t) => t.postedOn).sort()[0]!,
      description: lead.description,
      isInternal,
      governingDecisionId: linkGroups[0] ?? null,
      transactionIds: ids,
      legs,
    });
  }

  for (const ob of input.openingBalances) {
    const eventId = deterministicUuid('opening-balance', ob.accountId, ob.on);
    events.push({
      id: eventId,
      type: 'opening_balance',
      status: 'ok',
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
  if (event.isInternal) return leg.role === 'fee';
  return true;
}
