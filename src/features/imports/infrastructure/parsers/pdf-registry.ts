/**
 * Server-only registry that runs a PDF parser by id and returns canonical CSV.
 *
 * The provider parser modules (and the pdfjs dependency they pull in) are
 * imported dynamically so they never enter the client bundle. This module is
 * itself only reached via a dynamic import inside the `doParseFile` server
 * function, so its static `shared/canonical` import (which uses `node:fs`)
 * stays server-side too.
 */
import { legsToCanonicalCsv, type CanonicalLeg } from './shared/canonical'
import type { ParserId } from './parser-options'

export type PdfInput = { data: Uint8Array; filename: string }

async function runPdfParser(parserId: ParserId, files: PdfInput[]): Promise<CanonicalLeg[]> {
  switch (parserId) {
    case 'amex-pdf': {
      const { parseAmexPdf } = await import('./amex-pdf-parser')
      return parseAmexPdf(files)
    }
    case 'commbank-pdf': {
      const { parseCommbankPdf } = await import('./commbank-pdf-parser')
      return parseCommbankPdf(files)
    }
    case 'vanguard-pdf': {
      const { parseVanguardPdf } = await import('./vanguard-pdf-parser')
      return parseVanguardPdf(files)
    }
    default:
      throw new Error(`Not a PDF parser: ${parserId}`)
  }
}

/** Runs a PDF parser and serializes the result to canonical CSV text. */
export async function runPdfParserToCsv(parserId: ParserId, files: PdfInput[]): Promise<string> {
  const legs = await runPdfParser(parserId, files)
  return legsToCanonicalCsv(legs)
}
