export type InOutArgs = { inPath: string; outPath: string };

/**
 * Parses the common `--in <path> --out <path>` CLI flags shared by the
 * simple per-row CSV importer parsers (amex, vanguard, wise).
 */
export function parseInOutArgs(argv: string[], label: string): InOutArgs {
  const out: InOutArgs = { inPath: "", outPath: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in" && argv[i + 1]) out.inPath = argv[++i];
    else if (a === "--out" && argv[i + 1]) out.outPath = argv[++i];
    else if (a === "--help" || a === "-h") printInOutHelpAndExit(label, 0);
  }
  if (!out.inPath || !out.outPath) printInOutHelpAndExit(label, 1);
  return out;
}

export function printInOutHelpAndExit(label: string, code: number): never {
  console.error(
    `${label} CSV -> event/leg CSV\n\nRequired:\n  --in <path>   Input ${label} CSV\n  --out <path>  Output CSV`
  );
  process.exit(code);
}
