import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import { eq } from "drizzle-orm";
import { z } from "zod";

// ── Server function ───────────────────────────────────────────────────────────

const getImportRun = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { db } = await import("../../db");
    const { importRuns, accounts, instruments } = await import("../../db/schema");

    const [run] = await db
      .select({
        id: importRuns.id,
        filename: importRuns.filename,
        createdAt: importRuns.createdAt,
        importedCount: importRuns.importedCount,
        skippedCount: importRuns.skippedCount,
        restoredCount: importRuns.restoredCount,
        errorCount: importRuns.errorCount,
        skippedKeys: importRuns.skippedKeys,
        errors: importRuns.errors,
        restoreDeletedChosen: importRuns.restoreDeletedChosen,
        accountName: accounts.name,
        instrumentCode: instruments.code,
      })
      .from(importRuns)
      .innerJoin(accounts, eq(importRuns.accountId, accounts.id))
      .innerJoin(instruments, eq(importRuns.importInstrumentId, instruments.id))
      .where(eq(importRuns.id, data.id));

    if (!run) return null;

    return {
      ...run,
      createdAt: run.createdAt.toISOString(),
    };
  });

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/imports/$id")({
  loader: ({ params }) => getImportRun({ data: { id: params.id } }),
  component: ImportRunPage,
});

function ImportRunPage() {
  const run = Route.useLoaderData();

  if (!run) {
    return <p className="text-gray-500">Import run not found.</p>;
  }

  const errors = (run.errors as Array<{ line: number; message: string; phase?: string }>) ?? [];
  const skippedKeys = (run.skippedKeys as string[]) ?? [];

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <Link to="/imports" className="text-sm text-blue-600 hover:underline">
          ← Imports
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">{run.filename}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {run.accountName} · {run.instrumentCode} ·{" "}
        {new Date(run.createdAt).toLocaleString("en-AU")}
      </p>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Imported", value: run.importedCount, color: "text-green-600" },
          { label: "Skipped", value: run.skippedCount, color: "text-gray-600" },
          { label: "Restored", value: run.restoredCount, color: "text-blue-600" },
          { label: "Errors", value: run.errorCount, color: "text-red-600" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-lg border border-gray-200 p-3 text-center"
          >
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {run.restoreDeletedChosen && (
        <p className="text-sm text-blue-600 mb-4">
          ✓ Restore-deleted mode was active for this import.
        </p>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Errors ({errors.length})</h2>
          <div className="bg-red-50 rounded-lg border border-red-200 p-3 space-y-1">
            {errors.map((err, i) => (
              <p key={i} className="text-sm text-red-700">
                <span className="font-medium">Line {err.line}:</span>{" "}
                {err.message}
                {err.phase && (
                  <span className="ml-1 text-xs text-red-400">[{err.phase}]</span>
                )}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Skipped keys */}
      {skippedKeys.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-2">
            Skipped ({skippedKeys.length})
          </h2>
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 max-h-48 overflow-y-auto">
            {skippedKeys.map((key, i) => (
              <p key={i} className="text-xs font-mono text-gray-500 truncate">
                {key}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
