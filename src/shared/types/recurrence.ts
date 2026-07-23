/** Generic recurrence cadence, shared between the DB schema and any feature that needs recurring dates. */
export type RecurrenceRule =
  | { frequency: 'weekly' }
  | { frequency: 'fortnightly' }
  | { frequency: 'monthly' }
  | { frequency: 'start_of_month' }
  | { frequency: 'end_of_month' }
  | { frequency: 'yearly' }
