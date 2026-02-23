import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { useState, useRef } from "react";

// ── Server functions ──────────────────────────────────────────────────────────

const getImportPageData = createServerFn({ method: "GET" }).handler(
  async () => {
    const { db } = await import("../../db");
    const { importRuns, accounts, instruments, users } = await import(
      "../../db/schema"
    );

    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    if (!user) return { runs: [], accounts: [], instruments: [] };

    const runs = await db
      .select({
        id: importRuns.id,
        filename: importRuns.filename,
        createdAt: importRuns.createdAt,
        importedCount: importRuns.importedCount,
        skippedCount: importRuns.skippedCount,
        restoredCount: importRuns.restoredCount,
        errorCount: importRuns.errorCount,
        accountName: accounts.name,
      })
      .from(importRuns)
      .innerJoin(accounts, eq(importRuns.accountId, accounts.id))
      .where(eq(importRuns.userId, user.id))
      .orderBy(desc(importRuns.createdAt));

    const accountList = await db
      .select({ id: accounts.id, name: accounts.name, importerKey: accounts.importerKey })
      .from(accounts)
      .where(eq(accounts.userId, user.id));

    const instrumentList = await db
      .select({ id: instruments.id, code: instruments.code, name: instruments.name })
      .from(instruments)
      .where(eq(instruments.userId, user.id));

    return {
      runs: runs.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      accounts: accountList,
      instruments: instrumentList,
    };
  },
);

const submitImport = createServerFn({ method: "POST" })
  .validator(
    z.object({
      accountId: z.string(),
      importInstrumentId: z.string(),
      filename: z.string(),
      csvContent: z.string(),
      restoreDeletedChosen: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const { db } = await import("../../db");
    const { users } = await import("../../db/schema");
    const { runImport } = await import("../../lib/import-runner");

    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    if (!user) throw new Error("No user");

    const run = await runImport({
      userId: user.id,
      accountId: data.accountId,
      importInstrumentId: data.importInstrumentId,
      filename: data.filename,
      csvContent: data.csvContent,
      restoreDeletedChosen: data.restoreDeletedChosen,
    });

    return { runId: run.id };
  });

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/imports/")({
  loader: () => getImportPageData(),
  component: ImportsPage,
});

function ImportsPage() {
  const { runs, accounts, instruments } = Route.useLoaderData();
  const navigate = Route.useNavigate();

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [instrumentId, setInstrumentId] = useState(instruments[0]?.id ?? "");
  const [restoreDeleted, setRestoreDeleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !accountId || !instrumentId) {
      setError("Please select an account, instrument, and CSV file.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const csvContent = await file.text();
      const result = await submitImport({
        data: {
          accountId,
          importInstrumentId: instrumentId,
          filename: file.name,
          csvContent,
          restoreDeletedChosen: restoreDeleted,
        },
      });
      navigate({ to: "/imports/$id", params: { id: result.runId } });
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Imports</h1>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ── New import form ── */}
        <section>
          <h2 className="text-lg font-semibold mb-3">New Import</h2>
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-lg border border-gray-200 p-4 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Account
              </label>
              <select
                className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
              >
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.importerKey})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Import Instrument
              </label>
              <select
                className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
                required
              >
                <option value="">Select instrument…</option>
                {instruments.map((ins) => (
                  <option key={ins.id} value={ins.id}>
                    {ins.code} — {ins.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                The currency/instrument all amounts in the CSV are denominated in.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CSV File
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="text-sm text-gray-600"
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="restoreDeleted"
                type="checkbox"
                checked={restoreDeleted}
                onChange={(e) => setRestoreDeleted(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="restoreDeleted" className="text-sm text-gray-700">
                Restore previously soft-deleted duplicates
              </label>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded p-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Importing…" : "Import"}
            </button>
          </form>
        </section>

        {/* ── Import history ── */}
        <section>
          <h2 className="text-lg font-semibold mb-3">History</h2>
          {runs.length === 0 ? (
            <p className="text-gray-500 text-sm">No imports yet.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  to="/imports/$id"
                  params={{ id: run.id }}
                  className="block bg-white rounded-lg border border-gray-200 p-3 hover:border-blue-300"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-medium">{run.filename}</p>
                      <p className="text-xs text-gray-500">{run.accountName}</p>
                    </div>
                    <p className="text-xs text-gray-400">
                      {new Date(run.createdAt).toLocaleDateString("en-AU")}
                    </p>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    <span className="text-green-600">+{run.importedCount}</span>
                    <span>skip {run.skippedCount}</span>
                    <span>restore {run.restoredCount}</span>
                    {run.errorCount > 0 && (
                      <span className="text-red-500">err {run.errorCount}</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
