import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '@finance/db';
import type { LegRef } from './categorise';

export interface SimilarLeg extends LegRef {
  /** The leg in the current projection; it changes when events are rebuilt. */
  legId: string;
  postedOn: string;
  description: string;
  amount: string;
  commodity: string;
  accountName: string;
  categoryId: string | null;
}

export interface SimilarLegs {
  /** Uncategorised, same description ignoring case, spacing and punctuation (digits count). */
  identical: SimilarLeg[];
  /**
   * Uncategorised, same description key (digits ignored too) or the same first word of it, so
   * "WOOLWORTHS 1234 SYDNEY" and "WOOLWORTHS 5678 NEWTOWN" are similar. Words under three letters are ignored.
   */
  similar: SimilarLeg[];
  /** Identical or similar, but already in a different category. */
  categorised: SimilarLeg[];
  /** A section was cut at `limit` rows. */
  truncated: boolean;
}

/** Description with case, spacing and punctuation ignored but digits kept: "Corner Grocer #99" = "CORNER GROCER 99". */
const exactKey = (column: SQL) => sql`btrim(regexp_replace(lower(${column}), '[[:punct:][:space:]]+', ' ', 'g'))`;

/**
 * Legs that look like the given one, offered when it is categorised (feature 14) so the user can give
 * them the same category in the same step. Only active transactions whose leg has the same leg key and
 * can carry a category are considered; line items, the leg itself and legs already in `categoryId` are
 * left out. Nothing is applied here: the caller categorises whichever legs the user ticks.
 */
export async function findSimilarLegs(
  tx: Executor,
  workspaceId: string,
  leg: LegRef & { categoryId: string },
  limit = 150,
): Promise<SimilarLegs> {
  if (leg.legKey.startsWith('line:')) return { identical: [], similar: [], categorised: [], truncated: false };
  const rows = await tx.execute<{
    transaction_id: string;
    leg_key: string;
    leg_id: string;
    posted_on: string;
    description: string;
    amount: string;
    commodity: string;
    account_name: string;
    category_id: string | null;
    section: 'identical' | 'similar' | 'categorised';
  }>(sql`
    with source as (
      select description_key as key, ${exactKey(sql.raw('description'))} as exact,
        case when length(split_part(description_key, ' ', 1)) >= 3 then split_part(description_key, ' ', 1) end as merchant
      from transactions where id = ${leg.transactionId} and workspace_id = ${workspaceId} and description_key <> ''
    ),
    matches as (
      select t.id as transaction_id, l.leg_key, l.id as leg_id, t.posted_on::text, t.description, l.amount::text, t.commodity,
        a.name as account_name, l.category_id,
        case when l.category_id is not null then 'categorised'
          when ${exactKey(sql.raw('t.description'))} = s.exact then 'identical'
          else 'similar' end as section
      from source s
      join transactions t on t.workspace_id = ${workspaceId}
        and (t.description_key = s.key or t.description_key = s.merchant or t.description_key like s.merchant || ' %')
      join financial_accounts a on a.id = t.account_id
      join event_legs l on l.transaction_id = t.id and l.leg_key = ${leg.legKey}
      join events e on e.id = l.event_id
      where t.id <> ${leg.transactionId}
        and t.is_source_supported and not t.is_suppressed
        and (not e.is_internal or l.role = 'fee')
        and l.category_id is distinct from ${leg.categoryId}
    )
    select * from (
      select m.*, row_number() over (partition by section order by posted_on desc, transaction_id) as n from matches m
    ) ranked where n <= ${limit + 1}
    order by posted_on desc, transaction_id
  `);

  const out: SimilarLegs = { identical: [], similar: [], categorised: [], truncated: false };
  for (const r of rows) {
    const section = out[r.section];
    if (section.length === limit) {
      out.truncated = true;
      continue;
    }
    section.push({
      transactionId: r.transaction_id,
      legKey: r.leg_key,
      legId: r.leg_id,
      postedOn: r.posted_on,
      description: r.description,
      amount: r.amount,
      commodity: r.commodity,
      accountName: r.account_name,
      categoryId: r.category_id,
    });
  }
  return out;
}
