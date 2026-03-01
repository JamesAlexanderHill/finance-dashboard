import { Event, Account, Instrument, Leg } from './schema';

export type { User, Account, Instrument, Event, Leg, LineItem, Category } from './schema';

export type DecoratedEvent = Event & {
  account: Account,
  legs: (Leg & { instrument: Instrument })[],
}