import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { htmlMustacheConfigSchema } from '../js/shared/configSchema.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const OUT = path.join(
  REPO_ROOT,
  'schemas',
  'htmlmustache-config.schema.json',
);

const schema = z.toJSONSchema(htmlMustacheConfigSchema, {
  target: 'draft-7',
});

schema.$id =
  'https://raw.githubusercontent.com/reteps/tree-sitter-htmlmustache/main/schemas/htmlmustache-config.schema.json';
schema.title = 'HTML Mustache configuration';
schema.description = 'Configuration for .htmlmustache.jsonc files.';

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
console.log(`Wrote ${OUT}`);
