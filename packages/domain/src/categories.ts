export type CategoryKind = 'income' | 'expense';

/** The four fixed top-level categories (feature 14). They cannot be deleted or change kind. */
export const FIXED_CATEGORIES = [
  { name: 'Income', kind: 'income', sortOrder: 0 },
  { name: 'Savings', kind: 'expense', sortOrder: 1 },
  { name: 'Essentials', kind: 'expense', sortOrder: 2 },
  { name: 'Lifestyle', kind: 'expense', sortOrder: 3 },
] as const satisfies ReadonlyArray<{ name: string; kind: CategoryKind; sortOrder: number }>;

export type FixedCategoryName = (typeof FIXED_CATEGORIES)[number]['name'];

/** Top-level categories whose legs count as Spending. */
export const SPENDING_TOP_LEVEL: ReadonlyArray<FixedCategoryName> = ['Essentials', 'Lifestyle'];
