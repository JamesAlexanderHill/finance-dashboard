export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, unknown>

/** Minimal structured logger. Swap `write` for a real sink (e.g. pino, a log-shipping HTTP call) in production. */
export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  /** Returns a child logger that merges `fields` into every entry it logs — use for per-feature/per-request context. */
  child(fields: LogFields): Logger
}

const LEVEL_CONSOLE: Record<LogLevel, 'log' | 'info' | 'warn' | 'error'> = {
  debug: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error',
}

function write(level: LogLevel, message: string, fields: LogFields) {
  const entry = { level, message, time: new Date().toISOString(), ...fields }
  // eslint-disable-next-line no-console -- this is the logging sink itself
  console[LEVEL_CONSOLE[level]](JSON.stringify(entry))
}

function createLogger(baseFields: LogFields): Logger {
  return {
    debug: (message, fields) => write('debug', message, { ...baseFields, ...fields }),
    info: (message, fields) => write('info', message, { ...baseFields, ...fields }),
    warn: (message, fields) => write('warn', message, { ...baseFields, ...fields }),
    error: (message, fields) => write('error', message, { ...baseFields, ...fields }),
    child: (fields) => createLogger({ ...baseFields, ...fields }),
  }
}

/** App-wide root logger. Use `logger.child({ feature: 'imports' })` for feature-scoped context. */
export const logger: Logger = createLogger({})
