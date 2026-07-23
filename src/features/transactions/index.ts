/**
 * Public contract of the transactions feature (events + legs — the core
 * ledger). Other features and routes must import from here — never from
 * `./domain/*` or `./infrastructure/*` directly.
 */
export { eventService } from './domain/event-service'
export { EventDrawer } from './ui/event-drawer'
export { EventLegBar, buildCategoryColorMap } from './ui/event-leg-bar'
export { default as EventTable } from './ui/event-table'
export { default as EventPreviewTable } from './ui/event-preview-table'

export { transactionsFeature } from './feature'
