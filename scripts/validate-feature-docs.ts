/** Enforce reciprocal feature-document coverage. Run: bun scripts/validate-feature-docs.ts */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dir, '..', 'docs', 'features');
const files = readdirSync(dir).filter((name) => /^\d\d-[a-z0-9-]+\.md$/.test(name));
const expected = new Set(files);
let failures = 0;
for (const file of files) {
  const body = readFileSync(join(dir, file), 'utf8');
  if (!body.includes('## Interactions with **all** other registered features')) {
    console.error(`Missing interaction section: ${file}`);
    failures++;
  }
  for (const other of expected) {
    if (other === file) continue;
    const token = `](${other})`;
    const mentions = body.split(token).length - 1;
    if (mentions !== 1) {
      console.error(`Expected exactly one interaction row for ${other} in ${file}; found ${mentions}`);
      failures++;
    }
  }
  const rows = body.split('\n').filter((row) => /^\| \[[^\]]+\]\(\d\d-[a-z0-9-]+\.md\) \|/.test(row));
  if (rows.length !== expected.size - 1) {
    console.error(`Feature-count mismatch in ${file}: got ${rows.length}; expected ${expected.size - 1}`);
    failures++;
  }
}
if (failures) {
  console.error(`Documentation check failed: ${failures} issue(s)`);
  process.exit(1);
}
console.log(`Feature docs valid: ${files.length} features with complete interaction coverage.`);
