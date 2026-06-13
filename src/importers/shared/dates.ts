/** "DD/MM/YYYY" -> "YYYY-MM-DDT00:00:00Z" */
export function ddmmyyyyToIsoZ(dateStr: string): string {
  const m = dateStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error(`Invalid date: ${dateStr}`);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}T00:00:00Z`;
}
