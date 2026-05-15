import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { formatDocument } from '../formatter/document.js';
import type {
  FormattingOptions,
  FormatDocumentParams,
} from '../formatter/document.js';
import { formatEmbeddedRegions } from '../formatter/embedded.js';
import { getEditorConfigOptions } from '../formatter/editorconfig.js';
import {
  DEFAULT_FORMATTING_OPTIONS,
  formatParamsFromConfig,
  mergeOptions,
} from '../formatter/mergeOptions.js';
import { loadConfigFileForPath } from '../shared/configFile.js';
import { initializeParser, parseDocument } from './wasm';
import { resolveFiles } from './check';

const USAGE = `Usage: htmlmustache format [options] [patterns...]

Format HTML Mustache templates.

Arguments:
  patterns          One or more glob patterns (optional if "include" is set in config)

Options:
  --write           Modify files in-place (default: print to stdout)
  --check           Exit 1 if any files would change (for CI)
  --stdin           Read from stdin, write to stdout
  --indent-size N   Spaces per indent level (default: 2)
  --print-width N   Max line width (default: 80)
  --mustache-spaces Add spaces inside mustache delimiters
  --help            Show this help message

Examples:
  htmlmustache format --write '**/*.mustache'
  htmlmustache format --check 'templates/**/*.hbs'
  htmlmustache format --write                       (uses "include" from .htmlmustache.jsonc)
  echo '<div><p>hi</p></div>' | htmlmustache format --stdin`;

interface FormatFlags {
  write: boolean;
  check: boolean;
  stdin: boolean;
  indentSize: number | undefined;
  printWidth: number | undefined;
  mustacheSpaces: boolean | undefined;
  patterns: string[];
}

function parseFlags(args: string[]): FormatFlags {
  const flags: FormatFlags = {
    write: false,
    check: false,
    stdin: false,
    indentSize: undefined,
    printWidth: undefined,
    mustacheSpaces: undefined,
    patterns: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '--write':
        flags.write = true;
        break;
      case '--check':
        flags.check = true;
        break;
      case '--stdin':
        flags.stdin = true;
        break;
      case '--indent-size':
        i++;
        flags.indentSize = parseInt(args[i], 10);
        if (isNaN(flags.indentSize)) {
          console.error(chalk.red('Error: --indent-size requires a number'));
          process.exit(1);
        }
        break;
      case '--print-width':
        i++;
        flags.printWidth = parseInt(args[i], 10);
        if (isNaN(flags.printWidth)) {
          console.error(chalk.red('Error: --print-width requires a number'));
          process.exit(1);
        }
        break;
      case '--mustache-spaces':
        flags.mustacheSpaces = true;
        break;
      default:
        flags.patterns.push(arg);
        break;
    }
    i++;
  }

  return flags;
}

/**
 * Resolve all settings for a file with the full priority chain:
 *   defaults < .htmlmustache.jsonc < .editorconfig (indent only) < CLI flags
 */
async function resolveSettings(
  flags: FormatFlags,
  filePath?: string,
): Promise<
  {
    options: FormattingOptions;
  } & FormatDocumentParams
> {
  const configFile = filePath ? await loadConfigFileForPath(filePath) : null;
  let editorConfig: Partial<FormattingOptions> | undefined;
  if (filePath) {
    const uri = pathToFileURL(filePath).href;
    editorConfig = getEditorConfigOptions(uri);
  }

  const flagOptions: Partial<FormattingOptions> = {};
  if (flags.indentSize !== undefined) flagOptions.tabSize = flags.indentSize;

  const options = mergeOptions(DEFAULT_FORMATTING_OPTIONS, configFile, {
    ...editorConfig,
    ...flagOptions,
  });

  const params = formatParamsFromConfig(configFile, {
    printWidth: 80,
    mustacheSpaces: false,
  });
  if (flags.printWidth !== undefined) params.printWidth = flags.printWidth;
  if (flags.mustacheSpaces !== undefined) {
    params.mustacheSpaces = flags.mustacheSpaces;
  }

  return {
    options,
    ...params,
  };
}

let prettierModule: typeof import('prettier') | null | undefined;

async function getPrettier(): Promise<typeof import('prettier') | null> {
  if (prettierModule !== undefined) return prettierModule;
  try {
    prettierModule = await import('prettier');
    return prettierModule;
  } catch {
    prettierModule = null;
    return null;
  }
}

/**
 * Override the cached prettier module (for testing). Pass undefined to reset.
 * @internal
 */
export function _setPrettierForTesting(
  value: typeof import('prettier') | null | undefined,
) {
  prettierModule = value;
}

export async function formatSource(
  source: string,
  options: FormattingOptions,
  params: FormatDocumentParams = {},
): Promise<string> {
  const tree = parseDocument(source);
  const embeddedFormatted = await formatEmbeddedRegions(
    tree.rootNode,
    options,
    await getPrettier(),
  );
  const document = TextDocument.create(
    'file:///stdin',
    'htmlmustache',
    1,
    source,
  );
  const edits = formatDocument(tree, document, options, {
    ...params,
    embeddedFormatted:
      embeddedFormatted.size > 0 ? embeddedFormatted : undefined,
  });
  if (edits.length === 0) return source;
  return edits[0].newText;
}

export async function run(args: string[]): Promise<number> {
  if (args[0] === 'format') {
    args = args.slice(1);
  }

  if (args.includes('--help')) {
    console.log(USAGE);
    return 0;
  }

  const flags = parseFlags(args);

  // Stdin mode
  if (flags.stdin) {
    await initializeParser();
    const { options, ...params } = await resolveSettings(flags);
    const source = fs.readFileSync(0, 'utf-8');
    const formatted = await formatSource(source, options, params);
    process.stdout.write(formatted);
    return 0;
  }

  // File mode
  const { files, config } = await resolveFiles(flags.patterns);

  if (files.length === 0) {
    if (
      flags.patterns.length === 0 &&
      (!config?.include || config.include.length === 0)
    ) {
      console.log(USAGE);
      return 1;
    }
    const patterns =
      flags.patterns.length > 0 ? flags.patterns : (config?.include ?? []);
    console.error(chalk.yellow('No files matched the given patterns:'));
    for (const pattern of patterns) {
      console.error(chalk.yellow(`  ${pattern}`));
    }
    return 1;
  }

  await initializeParser();

  const cwd = process.cwd();
  let changedCount = 0;

  for (const file of files) {
    const displayPath = path.relative(cwd, file) || file;
    const source = fs.readFileSync(file, 'utf-8');
    const { options, ...params } = await resolveSettings(flags, file);
    const formatted = await formatSource(source, options, params);
    const changed = formatted !== source;

    if (changed) changedCount++;

    if (flags.check) {
      console.log(changed ? chalk.red(displayPath) : chalk.dim(displayPath));
    } else if (flags.write) {
      if (changed) {
        fs.writeFileSync(file, formatted);
      }
      console.log(changed ? chalk.green(displayPath) : chalk.dim(displayPath));
    } else {
      // Default: print to stdout
      process.stdout.write(formatted);
    }
  }

  if (flags.check && changedCount > 0) {
    console.log(
      chalk.red(
        `\n${changedCount} ${changedCount === 1 ? 'file' : 'files'} would be reformatted`,
      ),
    );
    return 1;
  }

  if (flags.check) {
    console.log(
      chalk.green(
        `All ${files.length} ${files.length === 1 ? 'file' : 'files'} already formatted`,
      ),
    );
  }

  return 0;
}
