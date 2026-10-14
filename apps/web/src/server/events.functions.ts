import { createServerFn } from '@tanstack/react-start';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { events, getDb } from '@finance/db';
import { workspaceMiddleware } from './session';

const eventFilter = z.object({
  accountId: z.uuid().optional(),
  type: z.string().max(40).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export interface EventLegView {
  id: string;
  accountName: string;
  role: string;
  amount: string;
  commodity: string;
  category: string | null;
  transactionId: string | null;
}

/** Cross-account event timeline with legs and their provenance. */
export const listEvents = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(eventFilter)
  .handler(async ({ context, data }) => {
    const where: Array<SQL | undefined> = [
      eq(events.workspaceId, context.workspaceId),
      data.type ? sql`${events.type}::text = ${data.type}` : undefined,
      data.from ? gte(events.occurredOn, data.from) : undefined,
      data.to ? lte(events.occurredOn, data.to) : undefined,
      data.accountId ? sql`exists (select 1 from event_legs l where l.event_id = "events"."id" and l.account_id = ${data.accountId})` : undefined,
    ];
    const rows = await getDb()
      .select({
        id: events.id,
        type: events.type,
        status: events.status,
        occurredOn: events.occurredOn,
        description: events.description,
        isInternal: events.isInternal,
        legs: sql<EventLegView[]>`(select json_agg(json_build_object(
            'id', l.id, 'accountName', fa.name, 'role', l.role, 'amount', l.amount::text, 'commodity', l.commodity,
            'category', c.name, 'transactionId', l.transaction_id) order by l.leg_key)
          from event_legs l join financial_accounts fa on fa.id = l.account_id
          left join categories c on c.id = l.category_id
          where l.event_id = "events"."id")`,
      })
      .from(events)
      .where(and(...where))
      .orderBy(desc(events.occurredOn), events.id)
      .limit(data.limit + 1)
      .offset(data.offset);
    return { rows: rows.slice(0, data.limit), hasMore: rows.length > data.limit };
  });
