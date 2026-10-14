import { createHash } from 'node:crypto';

const NAMESPACE = 'finance-dashboard/v1';

/** Name-based UUID (v5 layout, SHA-1) so projections get the same IDs on every rebuild. */
export function deterministicUuid(...parts: string[]): string {
  const hash = createHash('sha1').update(NAMESPACE).update('\u0000').update(parts.join('\u0000')).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
