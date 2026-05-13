/**
 * Node-only configuration discovery helpers.
 *
 * Pure schema types + parseJsonc + validateConfig live in
 * `js/shared/configSchema.ts` and are the browser-safe surface.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { parseJsonc, validateConfig } from './configSchema.js';
import type { HtmlMustacheConfig } from './configSchema.js';
import { loadSchemaRegistry } from './customTagSchemaLoader.js';
import type {
  ConfigLoadError,
  SchemaFormat,
  SchemaRegistry,
} from './customTagSchemaLoader.js';

const CONFIG_FILENAME = '.htmlmustache.jsonc';

const schemaCache = new Map<
  string,
  { schemaRegistry: SchemaRegistry; schemaLoadErrors: ConfigLoadError[] }
>();

const formatsModuleCache = new Map<string, LoadedFormatsModule>();

export interface LoadedFormatsModule {
  formats?: Record<string, SchemaFormat>;
  error?: ConfigLoadError;
}

function validateFormatsExport(
  value: unknown,
): Record<string, SchemaFormat> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, SchemaFormat> = {};
  for (const [name, format] of Object.entries(value)) {
    if (typeof name !== 'string' || name.length === 0) return null;
    const ok =
      typeof format === 'function' ||
      format instanceof RegExp ||
      (!!format && typeof format === 'object');
    if (!ok) return null;
    out[name] = format as SchemaFormat;
  }
  return out;
}

/**
 * Dynamically import the `formatsModule` referenced by a config. Returns the
 * formats record on success, or an error on failure. Cached per absolute path.
 *
 * The module's default export (or its named `formats` export) must be a
 * `Record<string, SchemaFormat>`. Anything else returns an error.
 */
export async function loadFormatsModule(
  configDir: string,
  modulePath: string,
): Promise<LoadedFormatsModule> {
  const absolute = path.resolve(configDir, modulePath);
  const cached = formatsModuleCache.get(absolute);
  if (cached) return cached;
  let result: LoadedFormatsModule;
  try {
    const mod = (await import(pathToFileURL(absolute).href)) as Record<
      string,
      unknown
    >;
    const exported =
      mod && typeof mod === 'object' && 'default' in mod
        ? mod.default
        : (mod as unknown);
    const formats =
      validateFormatsExport(exported) ?? validateFormatsExport(mod.formats);
    if (!formats) {
      result = {
        error: {
          message: `formatsModule "${modulePath}" must export a record of format functions, regexes, or ajv FormatDefinition objects.`,
        },
      };
    } else {
      result = { formats };
    }
  } catch (error) {
    result = {
      error: {
        message: `Failed to load formatsModule "${modulePath}": ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  formatsModuleCache.set(absolute, result);
  return result;
}

/**
 * Walk up directories from `startDir` looking for `.htmlmustache.jsonc`.
 * Returns the absolute path if found, or null.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    try {
      fs.accessSync(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // not found, keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) return null;
    dir = parent;
  }
}

export interface LoadedConfig extends HtmlMustacheConfig {
  config: HtmlMustacheConfig;
  /** Directory containing the .htmlmustache.jsonc — used to resolve relative globs. */
  configDir: string;
  schemaRegistry: SchemaRegistry;
  schemaLoadErrors: ConfigLoadError[];
}

function readSchemaFile(schemaPath: string, configDir: string): unknown {
  const resolved = path.resolve(configDir, schemaPath);
  return parseJsonc(fs.readFileSync(resolved, 'utf-8'));
}

function loadSchemasCached(
  config: HtmlMustacheConfig,
  configDir: string,
  formats: Record<string, SchemaFormat> | undefined,
  formatsCacheKey: string,
): { schemaRegistry: SchemaRegistry; schemaLoadErrors: ConfigLoadError[] } {
  const key = `${configDir}\0${formatsCacheKey}\0${JSON.stringify(config.customTags ?? [])}`;
  const cached = schemaCache.get(key);
  if (cached) return cached;
  const { registry: schemaRegistry, loadErrors: schemaLoadErrors } =
    loadSchemaRegistry(config.customTags, {
      configDir,
      loadFile: readSchemaFile,
      formats,
    });
  const result = { schemaRegistry, schemaLoadErrors };
  schemaCache.set(key, result);
  return result;
}

/**
 * Load config file for a file:// URI. Returns the parsed config + its
 * containing directory, or null if not found / not parseable.
 *
 * Async because the config's `formatsModule` (if any) is dynamically imported.
 */
export async function loadConfigFile(
  uri: string,
): Promise<LoadedConfig | null> {
  if (!uri.startsWith('file://')) return null;
  try {
    const filePath = fileURLToPath(uri);
    return await loadConfigFileForPath(filePath);
  } catch {
    return null;
  }
}

/**
 * Load config file for a filesystem path. Returns the parsed config + its
 * containing directory, or null.
 *
 * Async because the config's `formatsModule` (if any) is dynamically imported.
 */
export async function loadConfigFileForPath(
  filePath: string,
): Promise<LoadedConfig | null> {
  const dir = path.dirname(path.resolve(filePath));
  const configPath = findConfigFile(dir);
  if (!configPath) return null;
  let text: string;
  let raw: unknown;
  try {
    text = fs.readFileSync(configPath, 'utf-8');
    raw = parseJsonc(text);
  } catch {
    return null;
  }
  const config = validateConfig(raw);
  const configDir = path.dirname(configPath);
  const extraLoadErrors: ConfigLoadError[] = [];
  let formats: Record<string, SchemaFormat> | undefined;
  let formatsKey = '';
  if (config.formatsModule) {
    formatsKey = path.resolve(configDir, config.formatsModule);
    const loaded = await loadFormatsModule(configDir, config.formatsModule);
    if (loaded.error) extraLoadErrors.push(loaded.error);
    formats = loaded.formats;
  }
  const { schemaRegistry, schemaLoadErrors } = loadSchemasCached(
    config,
    configDir,
    formats,
    formatsKey,
  );
  return {
    ...config,
    config,
    configDir,
    schemaRegistry,
    schemaLoadErrors: [...extraLoadErrors, ...schemaLoadErrors],
  };
}
