// Re-exports all feature schemas as a single entry point for Drizzle migrations
// and for any code that needs to import from '~/db/schema'.
export * from '~/features/core/schema'
export * from '~/features/categories/schema'
export * from '~/features/transactions/schema'
