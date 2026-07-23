/**
 * Public contract of the accounts feature (accounts + their instruments,
 * balance checkpoints, and exchange rates). Other features and routes must
 * import from here — never from `./domain/*` or `./infrastructure/*` directly.
 */
export { accountService } from './domain/account-service'
export { instrumentService } from './domain/instrument-service'
export type {
  AccountBalance,
  BalancePoint,
  BalanceHistoryRange,
  BalanceHistoryPeriod,
} from './domain/instrument-service'
export { checkpointService } from './domain/checkpoint-service'
export { rateService } from './domain/rate-service'
export type { CurrentRate } from './domain/rate-service'

export { default as InstrumentCard } from './ui/instrument-card'
export { default as AccountColorSelect } from './ui/account-color-select'

export { accountsFeature } from './feature'
