import type { AppFeature } from '~/core/features'

export const importsFeature: AppFeature = {
  id: 'imports',
  dependencies: ['accounts', 'transactions', 'categories'],
  // No standalone nav entry — surfaced from within an account's page.
  register() {},
}
