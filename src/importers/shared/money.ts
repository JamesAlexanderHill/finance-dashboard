/**
 * Converts a decimal amount string (e.g. "-63.75", "+517.16", "1,200.00") to
 * an integer number of cents. Returns 0 for empty or non-numeric input.
 */
export function amountToCents(amountStr: string): number {
  const s0 = amountStr.trim().replaceAll(",", "");
  if (!s0 || isNaN(Number(s0))) return 0;
  const sign = s0.startsWith("-") ? -1 : 1;
  const s = s0.replace(/^[+-]/, "");
  const [dollarsRaw, centsRaw = ""] = s.split(".");
  const dollars = dollarsRaw.length ? parseInt(dollarsRaw, 10) : 0;
  const cents = parseInt((centsRaw + "00").slice(0, 2), 10);
  return sign * (dollars * 100 + cents);
}
