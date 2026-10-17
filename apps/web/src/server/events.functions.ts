import { createServerFn } from '@tanstack/react-start';
import { and, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  acceptSuggestionsInput,
  eventFilter,
  setCategoryForLegsInput,
  setLegCategoryInput,
  setLegTagsInput,
  similarLegsInput,
} from '@finance/contracts';
import { eventLegs, events, getDb, tags } from '@finance/db';
import {
  acceptSuggestions,
  categoriseLegs,
  findSimilarLegs,
  recordAssignments,
  suggestCategories,
  type LegRef,
} from '@finance/ledger/store';
import { workspaceMiddleware } from './session';

export class LegError extends Error {}

export interface EventLegView {
  id: string;
  legKey: string;
  accountName: string;
  role: 'principal' | 'fee' | 'line_item';
  description: string;
  amount: string;
  commodity: string;
  categoryId: string | null;
  /** The category suggested for an uncategorised leg (feature 14); it counts only once accepted. */
  suggestedCategoryId: string | null;
  tagIds: string[];
  transactionId: string | null;
  /** Whether the leg takes a category: not an opening balance or an internal event's principal leg. */
  categorisable: boolean;
}

/** A leg that needs a category: from a transaction, and not an internal event's principal leg. */
const categorisableLeg = sql`l.transaction_id is not null and (not e.is_internal or l.role = 'fee')`;

/**
 * Resolves current leg IDs to their stable identity (transaction + leg key), which assignments are
 * keyed on. Leg IDs change when events are rebuilt, so every ID must still exist in this workspace.
 */
async function ownedLegs(workspaceId: string, legIds: string[], categorisableOnly: boolean): Promise<LegRef[]> {
  const rows = await getDb()
    .select({
      id: eventLegs.id,
      transactionId: eventLegs.transactionId,
      legKey: eventLegs.legKey,
      categorisable: sql<boolean>`${eventLegs.transactionId} is not null and (not ${events.isInternal} or ${eventLegs.role} = 'fee')`,
    })
    .from(eventLegs)
    .innerJoin(events, eq(events.id, eventLegs.eventId))
    .where(and(eq(eventLegs.workspaceId, workspaceId), inArray(eventLegs.id, [...new Set(legIds)])));
  if (rows.length !== new Set(legIds).size) throw new LegError('Leg not found; reload and try again');
  const usable = rows.filter((r) => r.transactionId && (!categorisableOnly || r.categorisable));
  if (usable.length === 0) throw new LegError('This leg moves money between your accounts and is not categorised');
  return usable.map((r) => ({ transactionId: r.transactionId!, legKey: r.legKey }));
}

/** Cross-account event timeline with legs, their categories and provenance. */
export const listEvents = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(eventFilter)
  .handler(async ({ context, data }) => {
    const where: Array<SQL | undefined> = [
      eq(events.workspaceId, context.workspaceId),
      data.id ? eq(events.id, data.id) : undefined,
      data.type ? sql`${events.type}::text = ${data.type}` : undefined,
      data.from ? gte(events.occurredOn, data.from) : undefined,
      data.to ? lte(events.occurredOn, data.to) : undefined,
      data.accountId
        ? sql`exists (select 1 from event_legs l where l.event_id = "events"."id" and l.account_id = ${data.accountId})`
        : undefined,
      data.search
        ? sql`(${ilike(events.description, `%${data.search}%`)} or exists (select 1 from event_legs l
            where l.event_id = "events"."id" and l.description ilike ${`%${data.search}%`}))`
        : undefined,
      data.uncategorisedOnly
        ? sql`exists (select 1 from event_legs l join events e on e.id = l.event_id
            where l.event_id = "events"."id" and l.category_id is null and ${categorisableLeg})`
        : undefined,
    ];
    const rows = await getDb()
      .select({
        id: events.id,
        type: events.type,
        status: events.status,
        occurredOn: events.occurredOn,
        description: events.description,
        isInternal: events.isInternal,
        legs: sql<Omit<EventLegView, 'suggestedCategoryId'>[]>`(select json_agg(json_build_object(
            'id', l.id, 'legKey', l.leg_key, 'accountName', fa.name, 'role', l.role, 'description', l.description,
            'amount', l.amount::text, 'commodity', l.commodity, 'categoryId', l.category_id, 'tagIds', l.tag_ids,
            'transactionId', l.transaction_id, 'categorisable', ${categorisableLeg})
            order by l.transaction_id, l.leg_key)
          from event_legs l join events e on e.id = l.event_id join financial_accounts fa on fa.id = l.account_id
          where l.event_id = "events"."id")`,
      })
      .from(events)
      .where(and(...where))
      .orderBy(desc(events.occurredOn), events.id)
      .limit(data.limit + 1)
      .offset(data.offset);
    const page = rows.slice(0, data.limit);
    const transactionIds = [...new Set(page.flatMap((e) => e.legs.flatMap((l) => (l.transactionId ? [l.transactionId] : []))))];
    const suggestions = new Map(
      (await suggestCategories(getDb(), context.workspaceId, transactionIds)).map((s) => [`${s.transactionId}:${s.legKey}`, s.categoryId]),
    );
    return {
      rows: page.map((e) => ({
        ...e,
        legs: e.legs.map((l) => ({ ...l, suggestedCategoryId: suggestions.get(`${l.transactionId}:${l.legKey}`) ?? null })),
      })),
      hasMore: rows.length > data.limit,
    };
  });

export const setLegCategory = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setLegCategoryInput)
  .handler(async ({ context, data }) => {
    const legs = await ownedLegs(context.workspaceId, [data.legId], true);
    await getDb().transaction((tx) => categoriseLegs(tx, context.workspaceId, legs, data.categoryId, context.userId));
  });

/** Gives every selected leg one category; each leg still gets its own assignment. */
export const setCategoryForLegs = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setCategoryForLegsInput)
  .handler(async ({ context, data }) => {
    const legs = await ownedLegs(context.workspaceId, data.legIds, true);
    return getDb().transaction((tx) => categoriseLegs(tx, context.workspaceId, legs, data.categoryId, context.userId));
  });

/**
 * Legs like the one being categorised, in three sections (identical, similar, already in another
 * category), so the user can tick which also get the category. Applying goes through `setCategoryForLegs`.
 */
export const findSimilarLegsFor = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(similarLegsInput)
  .handler(async ({ context, data }) => {
    const [leg] = await ownedLegs(context.workspaceId, [data.legId], true);
    return findSimilarLegs(getDb(), context.workspaceId, { ...leg!, categoryId: data.categoryId });
  });

/** Accepts the suggested category of each given leg; each gets an ordinary category assignment. */
export const acceptCategorySuggestions = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(acceptSuggestionsInput)
  .handler(async ({ context, data }) => {
    const legs = await ownedLegs(context.workspaceId, data.legIds, true);
    return getDb().transaction((tx) => acceptSuggestions(tx, context.workspaceId, legs, context.userId));
  });

export const setLegTags = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setLegTagsInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    const [leg] = await ownedLegs(workspaceId, [data.legId], false);
    const names = [...new Set(data.tagNames)];
    await getDb().transaction(async (tx) => {
      if (names.length) {
        await tx
          .insert(tags)
          .values(names.map((name) => ({ workspaceId, name })))
          .onConflictDoNothing();
      }
      const rows = names.length
        ? await tx
            .select({ id: tags.id })
            .from(tags)
            .where(and(eq(tags.workspaceId, workspaceId), inArray(tags.name, names)))
        : [];
      await recordAssignments(tx, workspaceId, [
        { workspaceId, ...leg!, kind: 'tags', payload: { tagIds: rows.map((r) => r.id) }, userId },
      ]);
    });
  });
