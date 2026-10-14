import { getDocumentProxy } from 'unpdf';

export interface TextItem {
  x: number;
  /** Right edge; numeric columns are right-aligned so this is what identifies the column. */
  right: number;
  text: string;
}

export interface TextLine {
  page: number;
  y: number;
  items: TextItem[];
  text: string;
}

const LINE_TOLERANCE = 3;

/** Extracts positioned text lines from a PDF, top to bottom per page. */
export async function extractLines(bytes: Uint8Array): Promise<TextLine[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const lines: TextLine[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    // Landscape statements (e.g. IBKR) are portrait pages rotated 90°: text runs along the y axis, so
    // swap axes to keep "lines top to bottom, items left to right".
    const rotated = page.rotate === 90;
    const items = (content.items as Array<{ str?: string; transform?: number[]; width?: number }>)
      .filter((it) => it.str && it.str.trim() && it.transform)
      .map((it) => {
        const [tx, ty] = [it.transform![4]!, it.transform![5]!];
        const x = rotated ? ty : tx;
        return { y: rotated ? -tx : ty, item: { x, right: x + (it.width ?? 0), text: it.str!.trim() } };
      })
      .sort((a, b) => b.y - a.y || a.item.x - b.item.x);

    const pageLines: Array<{ y: number; items: TextItem[] }> = [];
    for (const { y, item } of items) {
      const line = pageLines.find((l) => Math.abs(l.y - y) <= LINE_TOLERANCE);
      if (line) line.items.push(item);
      else pageLines.push({ y, items: [item] });
    }
    for (const line of pageLines.sort((a, b) => b.y - a.y)) {
      line.items.sort((a, b) => a.x - b.x);
      lines.push({ page: pageNo, y: line.y, items: line.items, text: line.items.map((i) => i.text).join(' ') });
    }
  }
  await pdf.cleanup?.();
  return lines;
}
