/**
 * Convert a bigint value in minor units (e.g. cents) to a number in major
 * units (e.g. dollars), given the number of decimal places (`exponent`).
 *
 * Builds the decimal string directly (rather than dividing by 10 ** exponent)
 * so the result is correct to the available `number` precision for both
 * large and small magnitudes, including values between -1 and 1.
 *
 * ⚠️ UI-only: converts to `number`, which may lose precision for values
 * beyond Number.MAX_SAFE_INTEGER. Never use for storage or arithmetic.
 */
export default function scaleUnit(value: bigint, exponent: number): number {
  if (exponent === 0) return Number(value)

  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(exponent + 1, '0')
  const intPart = digits.slice(0, -exponent)
  const fracPart = digits.slice(-exponent)
  const magnitude = Number(`${intPart}.${fracPart}`)

  return negative ? -magnitude : magnitude
}
