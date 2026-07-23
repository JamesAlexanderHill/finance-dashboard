/** Public contract of the config capability: typed, validated environment access. */
export { getEnv, getSsoProviders, isMagicLinkEnabled, isPasskeyEnabled } from './env'
export type { Env, SsoProviderConfig } from './env'
