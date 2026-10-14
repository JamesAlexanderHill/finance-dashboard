/** ISO calendar dates (YYYY-MM-DD) handled as strings to avoid timezone drift. */
export type IsoDate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function isoDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  return isoDate(Math.floor(total / 12), (total % 12) + 1, 1);
}

export const startOfMonth = (date: IsoDate): IsoDate => `${date.slice(0, 7)}-01`;
export const endOfMonth = (date: IsoDate): IsoDate => addDays(addMonths(date, 1), -1);
export const todayIso = (): IsoDate => new Date().toISOString().slice(0, 10);
