import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import { useState } from "react";

// ── Guard: dev-only ───────────────────────────────────────────────────────────
// The nav only links to /dev when NODE_ENV=development, but the route itself
// is always registered. The component shows a warning in production.

// ── Server functions ──────────────────────────────────────────────────────────

const devClearAll = createServerFn({ method: "POST" }).handler(async () => {
  const { clearAllData } = await import("../lib/seed");
  await clearAllData();
  return { ok: true };
});

const devSeedBase = createServerFn({ method: "POST" }).handler(async () => {
  const { seedBase } = await import("../lib/seed");
  const result = await seedBase();
  return { ok: true, userId: result.userId };
});

const devSeedAll = createServerFn({ method: "POST" }).handler(async () => {
  const { seedBase, seedSampleEvents, seedVanguardTrade, seedWiseExchange } =
    await import("../lib/seed");
  const seed = await seedBase();
  await seedSampleEvents(seed);
  await seedVanguardTrade(seed);
  await seedWiseExchange(seed);
  return { ok: true, userId: seed.userId };
});

const devSeedSampleEvents = createServerFn({ method: "POST" }).handler(
  async () => {
    const { db } = await import("../db");
    const { users } = await import("../db/schema");
    const { seedBase, seedSampleEvents } = await import("../lib/seed");

    // Check if user exists
    const [existing] = await db.select({ id: users.id }).from(users).limit(1);
    if (!existing) throw new Error("Seed base data first");

    // Re-seed using existing base data — for simplicity, run a full seed
    const seed = await seedBase();
    await seedSampleEvents(seed);
    return { ok: true };
  },
);

const devSeedVanguardTrade = createServerFn({ method: "POST" }).handler(
  async () => {
    const { db } = await import("../db");
    const { users, profiles, instruments, accounts } = await import(
      "../db/schema"
    );
    const { seedVanguardTrade } = await import("../lib/seed");
    const { eq } = await import("drizzle-orm");

    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    if (!user) throw new Error("Seed base data first");

    const [profile] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);
    const instrumentRows = await db
      .select()
      .from(instruments)
      .where(eq(instruments.userId, user.id));
    const accountRows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user.id));

    const instrumentIds = Object.fromEntries(
      instrumentRows.map((i) => [i.code, i.id]),
    );
    const accountIds = Object.fromEntries(
      accountRows.map((a) => [
        a.name.toLowerCase().replace(/\s/g, ""),
        a.id,
      ]),
    );

    await seedVanguardTrade({
      userId: user.id,
      profileId: profile.id,
      instrumentIds,
      accountIds: {
        commbank: accountIds["commankeveryday"] ?? accountIds[Object.keys(accountIds)[0]],
        amex: accountIds["amex"],
        wise: accountIds["wise"],
        vanguardCash: accountIds["vanguardcash"],
        vanguardHoldings: accountIds["vanguardholdings"],
      },
      categoryIds: {},
    });

    return { ok: true };
  },
);

const devSeedWiseExchange = createServerFn({ method: "POST" }).handler(
  async () => {
    const { db } = await import("../db");
    const { users, profiles, instruments, accounts } = await import(
      "../db/schema"
    );
    const { seedWiseExchange } = await import("../lib/seed");
    const { eq } = await import("drizzle-orm");

    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    if (!user) throw new Error("Seed base data first");

    const [profile] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);
    const instrumentRows = await db
      .select()
      .from(instruments)
      .where(eq(instruments.userId, user.id));
    const accountRows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user.id));

    const instrumentIds = Object.fromEntries(
      instrumentRows.map((i) => [i.code, i.id]),
    );
    const accountIds = Object.fromEntries(
      accountRows.map((a) => [
        a.name.toLowerCase().replace(/\s/g, ""),
        a.id,
      ]),
    );

    await seedWiseExchange({
      userId: user.id,
      profileId: profile.id,
      instrumentIds,
      accountIds: {
        commbank: accountIds["commankeveryday"] ?? "",
        amex: accountIds["amex"] ?? "",
        wise: accountIds["wise"] ?? "",
        vanguardCash: accountIds["vanguardcash"] ?? "",
        vanguardHoldings: accountIds["vanguardholdings"] ?? "",
      },
      categoryIds: {},
    });

    return { ok: true };
  },
);

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/dev")({
  component: DevPage,
});

interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

function DevPage() {
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  async function run(key: string, fn: () => Promise<unknown>) {
    setLoading((p) => ({ ...p, [key]: true }));
    try {
      await fn();
      setResults((p) => ({ ...p, [key]: { ok: true } }));
    } catch (err) {
      setResults((p) => ({
        ...p,
        [key]: { ok: false, error: String(err) },
      }));
    } finally {
      setLoading((p) => ({ ...p, [key]: false }));
    }
  }

  const actions: Array<{ key: string; label: string; fn: () => Promise<unknown>; danger?: boolean }> = [
    {
      key: "clear",
      label: "Clear all user data",
      fn: () => devClearAll(),
      danger: true,
    },
    {
      key: "seedBase",
      label: "Seed dummy user + profile + instruments + accounts + categories",
      fn: () => devSeedBase(),
    },
    {
      key: "seedAll",
      label: "Seed everything (base + all sample events)",
      fn: () => devSeedAll(),
    },
    {
      key: "seedVanguard",
      label: "Seed Vanguard trade (Buy 19 VDAL)",
      fn: () => devSeedVanguardTrade(),
    },
    {
      key: "seedWise",
      label: "Seed Wise exchange (USD → AUD)",
      fn: () => devSeedWiseExchange(),
    },
  ];

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-1">Dev Tools</h1>
      <p className="text-sm text-amber-600 mb-6">
        ⚠ These actions modify the database directly. For development use only.
      </p>

      <div className="space-y-3">
        {actions.map((action) => (
          <div key={action.key} className="flex items-center gap-3">
            <button
              onClick={() => run(action.key, action.fn)}
              disabled={loading[action.key]}
              className={`text-sm px-4 py-2 rounded font-medium disabled:opacity-50 ${
                action.danger
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-gray-800 text-white hover:bg-gray-900"
              }`}
            >
              {loading[action.key] ? "Running…" : action.label}
            </button>

            {results[action.key] && (
              <span
                className={`text-sm ${
                  results[action.key].ok ? "text-green-600" : "text-red-600"
                }`}
              >
                {results[action.key].ok
                  ? "✓ Done"
                  : `✗ ${results[action.key].error}`}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
