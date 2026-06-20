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
  const scaledValue = scaleUnit(unitCount, exponent);
  const isCurrencyCode = /^[A-Za-z]{3}$/.test(ticker);

  if (isCurrencyCode) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: ticker,
        minimumFractionDigits: exponent,
        maximumFractionDigits: exponent,
      }).format(scaledValue);
    } catch {
      // fall through
    }
  }

  return `${ticker} ${scaledValue.toFixed(exponent)}`;
};

type formatMajorAmountOptions = {
  compact?: boolean;
};

/**
 * Formats a value already in major units (e.g. dollars, not cents) as
 * currency. Used for converted/derived amounts (e.g. an instrument's balance
 * converted to the home currency via an exchange rate), where there's no
 * underlying minor-unit bigint to scale.
 */
export function formatMajorAmount(value: number, ticker: string, { compact = false }: formatMajorAmountOptions = {}): string {
  const numberFormatOptions: Intl.NumberFormatOptions = compact
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { maximumFractionDigits: 2 };

  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: ticker,
      currencyDisplay: 'narrowSymbol',
      ...numberFormatOptions,
    }).format(value);
  } catch {
    return new Intl.NumberFormat('en-AU', numberFormatOptions).format(value);
  }
}
