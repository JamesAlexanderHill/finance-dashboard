/**
 * Public contract of the imports feature (bank/broker statement ingestion).
 * Other features and routes must import from here — never from `./domain/*`
 * or `./infrastructure/*` directly.
 */
export { importService } from './domain/import-service'
export type {
  BulkImportFile,
  CommitBulkImportParams,
  CommitImportParams,
  FileImportResult,
  InstrumentDraft,
  RawContent,
} from './domain/import-service'
export { fileService } from './domain/file-service'

export {
  ImportWizard,
  doCommitImport,
  doParseFile,
  fileToBase64,
  InstrumentReview,
  getAccountInstruments,
} from './ui/ImportWizard'
export type { ImportWizardProps } from './ui/ImportWizard'
export { BulkImportWizard, doCommitBulkImport } from './ui/BulkImportWizard'
export type { BulkImportWizardProps } from './ui/BulkImportWizard'

export { parseCanonicalCsv } from './infrastructure/parsers/canonical'
export type { ParsedEvent, ParseError } from './infrastructure/parsers/canonical'
export { PARSER_OPTIONS, DEFAULT_PARSER_ID, parserLabel } from './infrastructure/parsers/parser-options'
export type { ParserId } from './infrastructure/parsers/parser-options'
// `runPdfParserToCsv` (from `./infrastructure/parsers/pdf-registry`) is deliberately
// NOT re-exported here: it must only ever be reached via a dynamic `import()`
// (see `ImportWizard.tsx`'s `doParseFile`), so its own static `node:fs`-using
// import stays out of the client bundle. A static re-export here would defeat that.

export { importsFeature } from './feature'
