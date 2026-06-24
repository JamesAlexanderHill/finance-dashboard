import { registry } from '~/features/registry'

registry.register({
  id: 'transactions',
  client: {
    navLinks: [
      { label: 'Accounts', to: '/accounts' },
      { label: 'Events', to: '/events' },
    ],
  },
})

export { EventDrawer } from './components/event/event-drawer'
export { default as EventTable } from './components/event/event-table'
export { default as EventPreviewTable } from './components/event/event-preview-table'
export { ImportWizard } from './components/ImportWizard'
export { BulkImportWizard } from './components/BulkImportWizard'
export { default as InstrumentCard } from './components/instrument-card'

export { AccountsListPage, accountsListLoader } from './accounts-list-page'
export type { AccountsListPageData } from './accounts-list-page'
export { AccountDetailPage, accountDetailLoader } from './account-detail-page'
export type { AccountDetailPageData } from './account-detail-page'
export { AccountEventsPage, accountEventsLoader } from './account-events-page'
export type { AccountEventsPageData } from './account-events-page'
export { AccountFilesPage, accountFilesLoader } from './account-files-page'
export type { AccountFilesPageData } from './account-files-page'
export { FileDetailPage, fileDetailLoader } from './file-detail-page'
export type { FileDetailPageData } from './file-detail-page'
export { AccountInstrumentsPage, accountInstrumentsLoader } from './account-instruments-page'
export type { AccountInstrumentsPageData } from './account-instruments-page'
export { InstrumentDetailPage, instrumentDetailLoader } from './instrument-detail-page'
export type { InstrumentDetailPageData } from './instrument-detail-page'
export { EventsPage, eventsLoader } from './events-page'
export type { EventsPageData } from './events-page'
