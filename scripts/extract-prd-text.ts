import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const xmlPath = process.argv[2];
const outPath = process.argv[3];
if (xmlPath === undefined || outPath === undefined) {
  throw new Error('usage: extract-prd-text.ts <xml-input> <text-output>');
}
const x = readFileSync(path.resolve(xmlPath), 'utf8');
const text = x
  .replace(/<w:p[^>]*>/g, '\n\n')
  .replace(/<w:tab\/?>/g, '  ')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n');
writeFileSync(path.resolve(outPath), text);
process.stdout.write(`lines=${text.split('\n').length} chars=${text.length}\n`);
