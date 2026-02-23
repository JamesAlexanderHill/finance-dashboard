import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import { eq, isNull, desc, and } from "drizzle-orm";
import { z } from "zod";

// ── Server functions ──────────────────────────────────────────────────────────

const getEvents = createServerFn({ method: "GET" })
  .validator(z.object({ accountId: z.string().optional() }))
  .handler(async ({ data }) => {
    const { db } = await import("../../db");
    const { events, accounts, users } = await import("../../db/schema");

    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    if (!user) return { events: [], accounts: [] };

    const whereConditions = [eq(events.userId, user.id), isNull(events.deletedAt)];
    if (data?.accountId) {
      whereConditions.push(eq(events.accountId, data.accountId));
    }

    const rows = await db
      .select({
        id: events.id,
        eventType: events.eventType,
        effectiveAt: events.effectiveAt,
        description: events.description,
        accountId: events.accountId,
        accountName: accounts.name,
      })
      .from(events)
      .innerJoin(accounts, eq(events.accountId, accounts.id))
      .where(and(...whereConditions))
      .orderBy(desc(events.effectiveAt))
      .limit(100);

    const accountRows = await db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.userId, user.id));

    return {
      events: rows.map((e) => ({
        ...e,
        effectiveAt: e.effectiveAt.toISOString(),
      })),
      accounts: accountRows,
    };
  });

const softDeleteEvent = createServerFn({ method: "POST" })
  .validator(z.object({ eventId: z.string() }))
  .handler(async ({ data }) => {
    const { db } = await import("../../db");
    const { events } = await import("../../db/schema");

    await db
      .update(events)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(events.id, data.eventId));
  });

// ── Route ─────────────────────────────────────────────────────────────────────

const searchSchema = z.object({ accountId: z.string().optional() });

export const Route = createFileRoute("/events/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ accountId: search.accountId }),
  loader: ({ deps }) => getEvents({ data: deps }),
  component: EventsPage,
});

const EVENT_TYPE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  transfer: "Transfer",
  exchange: "Exchange",
  trade: "Trade",
  bill_payment: "Bill Payment",
  payout: "Payout",
};

function EventsPage() {
  const { events: rows, accounts } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  async function handleDelete(eventId: string) {
    if (!confirm("Soft-delete this event? It will be excluded from balances."))
      return;
    await softDeleteEvent({ data: { eventId } });
    navigate({ to: "/events", search });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Events</h1>
        <select
          className="text-sm border border-gray-300 rounded px-2 py-1"
          value={search.accountId ?? ""}
          onChange={(e) =>
            navigate({
              to: "/events",
              search: { accountId: e.target.value || undefined },
            })
          }
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 && (
        <p className="text-gray-500">No events found.</p>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 text-gray-600 font-medium">Date</th>
              <th className="text-left px-4 py-2 text-gray-600 font-medium">Description</th>
              <th className="text-left px-4 py-2 text-gray-600 font-medium">Account</th>
              <th className="text-left px-4 py-2 text-gray-600 font-medium">Type</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((event) => (
              <tr key={event.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                  {new Date(event.effectiveAt).toLocaleDateString("en-AU")}
                </td>
                <td className="px-4 py-2">
                  <Link
                    to="/events/$id"
                    params={{ id: event.id }}
                    className="text-blue-600 hover:underline"
                  >
                    {event.description}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-600">{event.accountName}</td>
                <td className="px-4 py-2">
                  <span className="inline-block text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleDelete(event.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
