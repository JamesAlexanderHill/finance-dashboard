import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { formatAmount } from "../../lib/balance";

// ── Server function ───────────────────────────────────────────────────────────

const getEvent = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { db } = await import("../../db");
    const { events, legs, instruments, accounts, lineItems, categories } =
      await import("../../db/schema");

    const [event] = await db
      .select({
        id: events.id,
        eventType: events.eventType,
        effectiveAt: events.effectiveAt,
        postedAt: events.postedAt,
        description: events.description,
        externalId: events.externalId,
        dedupeKey: events.dedupeKey,
        deletedAt: events.deletedAt,
        meta: events.meta,
        accountName: accounts.name,
      })
      .from(events)
      .innerJoin(accounts, eq(events.accountId, accounts.id))
      .where(eq(events.id, data.id));

    if (!event) return null;

    const legRows = await db
      .select({
        id: legs.id,
        amountMinor: legs.amountMinor,
        accountName: accounts.name,
        instrumentCode: instruments.code,
        instrumentMinorUnit: instruments.minorUnit,
        categoryName: categories.name,
      })
      .from(legs)
      .innerJoin(accounts, eq(legs.accountId, accounts.id))
      .innerJoin(instruments, eq(legs.instrumentId, instruments.id))
      .leftJoin(categories, eq(legs.categoryId, categories.id))
      .where(eq(legs.eventId, data.id));

    const lineItemRows = await Promise.all(
      legRows.map(async (leg) => {
        const items = await db
          .select({
            id: lineItems.id,
            amountMinor: lineItems.amountMinor,
            description: lineItems.description,
            categoryName: categories.name,
          })
          .from(lineItems)
          .leftJoin(categories, eq(lineItems.categoryId, categories.id))
          .where(eq(lineItems.legId, leg.id));
        return { legId: leg.id, items };
      }),
    );

    const lineItemsByLeg = Object.fromEntries(
      lineItemRows.map((r) => [r.legId, r.items]),
    );

    return {
      event: {
        ...event,
        effectiveAt: event.effectiveAt.toISOString(),
        postedAt: event.postedAt?.toISOString() ?? null,
        deletedAt: event.deletedAt?.toISOString() ?? null,
      },
      legs: legRows.map((l) => ({
        ...l,
        amountMinor: l.amountMinor.toString(),
      })),
      lineItemsByLeg: Object.fromEntries(
        Object.entries(lineItemsByLeg).map(([legId, items]) => [
          legId,
          items.map((i) => ({ ...i, amountMinor: i.amountMinor.toString() })),
        ]),
      ),
    };
  });

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/events/$id")({
  loader: ({ params }) => getEvent({ data: { id: params.id } }),
  component: EventDetailPage,
});

const EVENT_TYPE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  transfer: "Transfer",
  exchange: "Exchange",
  trade: "Trade",
  bill_payment: "Bill Payment",
  payout: "Payout",
};

function EventDetailPage() {
  const data = Route.useLoaderData();

  if (!data) {
    return <p className="text-gray-500">Event not found.</p>;
  }

  const { event, legs, lineItemsByLeg } = data;

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <Link to="/events" className="text-sm text-blue-600 hover:underline">
          ← Events
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">{event.description}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType} ·{" "}
        {event.accountName} ·{" "}
        {new Date(event.effectiveAt).toLocaleDateString("en-AU")}
        {event.deletedAt && (
          <span className="ml-2 text-red-500">(soft-deleted)</span>
        )}
      </p>

      {/* Legs */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Legs</h2>
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 text-gray-600 font-medium">Account</th>
                <th className="text-left px-4 py-2 text-gray-600 font-medium">Instrument</th>
                <th className="text-right px-4 py-2 text-gray-600 font-medium">Amount</th>
                <th className="text-left px-4 py-2 text-gray-600 font-medium">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {legs.map((leg) => (
                <tr key={leg.id}>
                  <td className="px-4 py-2">{leg.accountName}</td>
                  <td className="px-4 py-2 text-gray-600">{leg.instrumentCode}</td>
                  <td
                    className={`px-4 py-2 text-right font-mono ${
                      BigInt(leg.amountMinor) < 0n
                        ? "text-red-600"
                        : "text-green-700"
                    }`}
                  >
                    {formatAmount(
                      BigInt(leg.amountMinor),
                      leg.instrumentMinorUnit,
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs">
                    {leg.categoryName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Line items (if any) */}
        {legs.map((leg) => {
          const items = lineItemsByLeg[leg.id] ?? [];
          if (items.length === 0) return null;
          return (
            <div key={leg.id} className="mt-2 ml-4">
              <p className="text-xs text-gray-400 mb-1">
                Line items for leg ({leg.instrumentCode})
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.id} className="flex justify-between text-xs text-gray-600">
                    <span>{item.description ?? item.categoryName ?? "—"}</span>
                    <span className="font-mono">
                      {formatAmount(
                        BigInt(item.amountMinor),
                        leg.instrumentMinorUnit,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {/* Metadata */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Details</h2>
        <dl className="bg-white rounded-lg border border-gray-200 p-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">Dedupe key</dt>
          <dd className="font-mono text-xs break-all">{event.dedupeKey}</dd>
          {event.externalId && (
            <>
              <dt className="text-gray-500">External ID</dt>
              <dd className="font-mono text-xs">{event.externalId}</dd>
            </>
          )}
          {event.postedAt && (
            <>
              <dt className="text-gray-500">Posted at</dt>
              <dd>{new Date(event.postedAt).toLocaleDateString("en-AU")}</dd>
            </>
          )}
          {event.meta && (
            <>
              <dt className="text-gray-500">Meta</dt>
              <dd className="font-mono text-xs col-span-1">
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(event.meta, null, 2)}
                </pre>
              </dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}
