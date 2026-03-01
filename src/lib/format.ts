import { Instrument } from "~/db/schema"

/**
 * Convert a bigint value representing an amount in minor units (e.g., cents) to a number in major units (e.g., dollars) based on the provided exponent.
 *
 * ⚠️ WARNING: This is for UI-only purposes and may lose precision at huge magnitudes
 * 
 * @param value - A value in minor units (eg cents for AUD)
 * @param exponent - The amount of decimal places e.g. 2 for AUD cents
 * @returns A number representing the value in major units (e.g. dollars for AUD)
 */
function formatBigIntToNumber(value: bigint, exponent: number): number {
  if (exponent === 0) return Number(value);

  const s = value.toString();
  const e = exponent;

  const padded = s.length <= e ? "0".repeat(e + 1 - s.length) + s : s;
  const intPart = padded.slice(0, padded.length - e);
  const fracPart = padded.slice(padded.length - e);

  return Number(`${intPart}.${fracPart}`);
}

/**
 * Returns a formatted string representing a balance for a given instrument,
 * including the currency symbol (if applicable), and ticker.
 *
 * @param balance - A bigint value representing the lowest nominal value (e.g. cents for AUD)
 * @param instrument - The instrument associated with the balance, which includes the ticker and exponent for formatting
 *
 * @returns A formatted string representing the balance
 *
 * Examples:
 * const aud: Instrument = { id: '1', userId: 'u1', accountId: 'a1', name: 'Australian Dollar', ticker: 'AUD', exponent: 2 }
 * const vhy: Instrument = { id: '2', userId: 'u1', accountId: 'a1', name: 'Vanguard High Yield ETF', ticker: 'VHY', exponent: 0 }
 * formatBalance(12345n, aud) => "AUD 123.45"
 * formatBalance(-6789n, aud) => "-AUD 67.89"
 * formatBalance(1000n, vhy) => "VHY 1000"
 * formatBalance(-500n, vhy) => "-VHY 500"
 */
export function formatBalance(balance: bigint, instrument: Instrument, options?: Intl.NumberFormatOptions): string {
    // UI-only: convert to Number for toFixed/adaptive rules
    const major = formatBigIntToNumber(balance, instrument.exponent);

    try {
        const formatter = new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: instrument.ticker,
            currencyDisplay: "code",
            minimumFractionDigits: instrument.exponent,
            maximumFractionDigits: instrument.exponent,
            ...options,
        });
        return formatter.format(major);
    } catch (err) {
        console.error('Error formatting currency for UI:', err);

        // Fallback to a simple format if Intl fails (e.g., due to unsupported currency code)
        return `${instrument.ticker} ${major.toFixed(instrument.exponent)}`;
    };
}

/**
 * Returns a formatted string representing a change in balance for a given instrument,
 * including the appropriate sign, currency symbol (if applicable), and ticker.
 *
 * @param unitCount - A bigint value representing the lowest nominal value (e.g. cents for AUD)
 * @param instrument - The instrument associated with the unit count, which includes the ticker and exponent for formatting
 * @returns A formatted string representing the change, prefixed with '+' for positive changes and '-' for negative changes
 * 
 * Examples:
 * const aud: Instrument = { id: '1', userId: 'u1', accountId: 'a1', name: 'Australian Dollar', ticker: 'AUD', exponent: 2 }
 * const vhy: Instrument = { id: '2', userId: 'u1', accountId: 'a1', name: 'Vanguard High Yield ETF', ticker: 'VHY', exponent: 0 }
 * formatChange(12345n, aud) => "+AUD 123.45"
 * formatChange(-6789n, aud) => "-AUD 67.89"
 * formatChange(1000n, vhy) => "+VHY 1000"
 * formatChange(-500n, vhy) => "-VHY 500"
 */
export function formatChange(unitCount: bigint, instrument: Instrument): string {
  return formatBalance(unitCount, instrument, { signDisplay: "exceptZero" });
}