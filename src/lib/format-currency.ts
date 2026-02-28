import scaleUnit from "~/lib/scale-unit";

type formatCurrencyOptions = {
  exponent?: number;
  ticker?: string;
  locale?: string;
};

/**
 * Formats a value stored in the smallest unit (e.g. cents)
 * into a human-readable currency string.
 *
 * ⚠️ WARNING:
 * This function converts bigint to number for use with Intl.NumberFormat.
 * Values larger than Number.MAX_SAFE_INTEGER may lose precision.
 * Do NOT use for high-precision financial ledgers.
 */
export function formatCurrency(unitCount: bigint, {
  exponent = 2,
  ticker = 'AUD',
  locale = 'en-AU',
}: formatCurrencyOptions = {}): string {
  try {
    // Convert from smallest unit (e.g. cents) to major unit (e.g. dollars)
    const scaledValue = scaleUnit(unitCount, exponent);
    
    const formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: ticker,
        minimumFractionDigits: exponent,
        maximumFractionDigits: exponent,
    });

    return formatter.format(scaledValue);
  } catch (err) {
    const scaledValue = scaleUnit(unitCount, exponent);
    console.error('Error formatting currency:', err);

    // Fallback to a simple format if Intl fails (e.g., due to unsupported currency code)
    return `${ticker} ${scaledValue.toFixed(exponent)}`;
  };
};
