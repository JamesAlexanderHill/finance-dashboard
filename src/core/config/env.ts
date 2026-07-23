import { z } from 'zod'

/** One externally-hosted identity provider Better Auth's `genericOAuth` plugin can sign in against. */
const ssoProviderSchema = z.object({
  providerId: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  /** Either set `discoveryUrl` (OIDC discovery) or the three URLs below explicitly. */
  discoveryUrl: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  userInfoUrl: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
})

export type SsoProviderConfig = z.infer<typeof ssoProviderSchema>

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),
  PASSKEY_RP_ID: z.string().default('localhost'),

  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | undefined

/**
 * Validated, typed process environment covering the variables the app cannot
 * meaningfully run without (database, Better Auth). Throws with a readable,
 * field-by-field message if any are missing or malformed.
 *
 * This is a deliberate, explicit call — meant to run once at real server
 * startup (e.g. from a boot check or the `/api/health` route) — not a module
 * imported broadly. Broadly-imported modules like `~/core/auth/auth` read
 * individual variables directly with safe fallbacks instead, precisely so
 * they can still be imported (e.g. by tests) in environments where the full
 * config isn't set; those tests then skip themselves based on what's missing.
 */
export function getEnv(): Env {
  if (cached) return cached

  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  cached = result.data
  return cached
}

/**
 * Parsed, validated SSO provider list from `AUTH_SSO_PROVIDERS_JSON`. Empty
 * when unset — reads the raw variable directly (not via `getEnv()`) so it
 * stays independent of whether the rest of the environment is configured.
 */
export function getSsoProviders(): SsoProviderConfig[] {
  const raw = process.env.AUTH_SSO_PROVIDERS_JSON
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('AUTH_SSO_PROVIDERS_JSON is not valid JSON')
  }

  const result = z.array(ssoProviderSchema).safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid AUTH_SSO_PROVIDERS_JSON:\n${issues}`)
  }
  return result.data
}

/** Whether magic-link sign-in is enabled. Defaults to on; set `AUTH_MAGIC_LINK_ENABLED=false` to disable. */
export function isMagicLinkEnabled(): boolean {
  return process.env.AUTH_MAGIC_LINK_ENABLED !== 'false'
}

/** Whether WebAuthn passkey sign-in is enabled. Defaults to on; set `AUTH_PASSKEY_ENABLED=false` to disable. */
export function isPasskeyEnabled(): boolean {
  return process.env.AUTH_PASSKEY_ENABLED !== 'false'
}
