import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import { getUserBalances, formatAmount } from "../lib/balance";

// ── Server function ───────────────────────────────────────────────────────────

const DUMMY_USER_ID_KEY = "dummy_user_id";

async function getDummyUserId(): Promise<string | null> {
  const { db } = await import("../db");
  const { users } = await import("../db/schema");
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  return user?.id ?? null;
}

const getAccountBalances = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await getDummyUserId();
    if (!userId) return { balances: [], grouped: {} };

    const balances = await getUserBalances(userId);

    // Group by account
    const grouped: Record<
      string,
      {
        accountName: string;
        balances: Array<{
          instrumentCode: string;
          instrumentKind: string;
          amountMinor: string;
          minorUnit: number;
        }>;
      }
    > = {};

    for (const b of balances) {
      if (!grouped[b.accountId]) {
        grouped[b.accountId] = { accountName: b.accountName, balances: [] };
      }
      grouped[b.accountId].balances.push({
        instrumentCode: b.instrumentCode,
        instrumentKind: b.instrumentKind,
        amountMinor: b.amountMinor.toString(),
        minorUnit: b.instrumentMinorUnit,
      });
    }

    return { grouped };
  },
);

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/accounts")({
  loader: () => getAccountBalances(),
  component: AccountsPage,
});

function AccountsPage() {
  const { grouped } = Route.useLoaderData();
  const entries = Object.entries(grouped ?? {});

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Accounts</h1>

      {entries.length === 0 && (
        <p className="text-gray-500">
          No accounts found. Use the{" "}
          <a href="/dev" className="text-blue-600 underline">
            Dev page
          </a>{" "}
          to seed data.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([accountId, data]) => (
          <div
            key={accountId}
            className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm"
          >
            <h2 className="font-semibold text-gray-800 mb-3">{data.accountName}</h2>
            {data.balances.length === 0 ? (
              <p className="text-sm text-gray-400">No activity</p>
            ) : (
              <ul className="space-y-1">
                {data.balances.map((b) => (
                  <li
                    key={b.instrumentCode}
                    className="flex justify-between text-sm"
                  >
                    <span className="text-gray-500">
                      {b.instrumentCode}
                      {b.instrumentKind === "security" && (
                        <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1 rounded">
                          security
                        </span>
                      )}
                    </span>
                    <span
                      className={
                        BigInt(b.amountMinor) < 0n
                          ? "text-red-600 font-mono"
                          : "text-gray-900 font-mono"
                      }
                    >
                      {formatAmount(BigInt(b.amountMinor), b.minorUnit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
