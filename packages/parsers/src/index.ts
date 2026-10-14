import { UnsupportedStatementError, type ParsedStatement } from '@finance/domain';
import { detectCommbankLayout, parseCommbankPdf } from './commbank/pdf';
import { extractLines } from './pdf';
import { detectVanguard, parseVanguardPdf } from './vanguard/pdf';
import { detectWise, parseWisePdf } from './wise/pdf';

export { COMMBANK_PDF_PARSER_ID, COMMBANK_PDF_PARSER_VERSION } from './commbank/pdf';
export { extractLines } from './pdf';
export { VANGUARD_PDF_PARSER_ID, VANGUARD_PDF_PARSER_VERSION } from './vanguard/pdf';
export { WISE_PDF_PARSER_ID, WISE_PDF_PARSER_VERSION } from './wise/pdf';

/**
 * Parses a statement file with the first parser that recognises it.
 * Throws UnsupportedStatementError rather than guessing at an unknown format.
 */
export async function parseStatement(bytes: Uint8Array, contentType: string): Promise<ParsedStatement> {
  const isPdf = contentType === 'application/pdf' || new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
  if (!isPdf) throw new UnsupportedStatementError(`No parser supports ${contentType} files yet`);
  const lines = await extractLines(bytes);
  if (detectCommbankLayout(lines)) return parseCommbankPdf(lines);
  if (detectWise(lines)) return parseWisePdf(lines);
  if (detectVanguard(lines)) return parseVanguardPdf(lines);
  throw new UnsupportedStatementError('No parser recognises this PDF');
}
