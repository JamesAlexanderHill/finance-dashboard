import type { AppFeature } from '~/core/features'

export const relationsFeature: AppFeature = {
  id: 'relations',
  // No dedicated route/nav entry — relations are surfaced inline within the
  // transactions feature's event drawer.
  register() {},
}
