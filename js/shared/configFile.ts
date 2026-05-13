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
  SchemaKeyword,
  SchemaRegistry,
} from './customTagSchemaLoader.js';

const CONFIG_FILENAME = '.htmlmustache.jsonc';

const schemaCache = new Map<
  string,
  { schemaRegistry: SchemaRegistry; schemaLoadErrors: ConfigLoadError[] }
>();

const ajvModuleCache = new Map<string, LoadedAjvModule>();

export interface LoadedAjvModule {
  formats?: Record<string, SchemaFormat>;
  keywords?: Record<string, SchemaKeyword>;
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

function validateKeywordsExport(
  value: unknown,
): Record<string, SchemaKeyword> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, SchemaKeyword> = {};
  for (const [name, keyword] of Object.entries(value)) {
    if (typeof name !== 'string' || name.length === 0) return null;
    if (!keyword || typeof keyword !== 'object' || Array.isArray(keyword)) {
      return null;
    }
    out[name] = keyword as SchemaKeyword;
  }
  return out;
}

/**
 * Dynamically import the module referenced by `ajvModule`. The module must
 * expose at least one of two named exports: `formats` (record of format
 * functions, regexes, or ajv FormatDefinition objects) and/or `keywords`
 * (record of ajv KeywordDefinition objects minus the `keyword` field).
 * Cached per absolute path.
 *
 * A module that supplies only one of the two is fine — the other simply
 * isn't registered.
 */
export async function loadAjvModule(
  configDir: string,
  modulePath: string,
): Promise<LoadedAjvModule> {
  const absolute = path.resolve(configDir, modulePath);
  const cached = ajvModuleCache.get(absolute);
  if (cached) return cached;
  let result: LoadedAjvModule;
  try {
    const mod = (await import(pathToFileURL(absolute).href)) as Record<
      string,
      unknown
    >;
    const formats = validateFormatsExport(mod.formats);
    const keywords = validateKeywordsExport(mod.keywords);
    if (!formats && !keywords) {
      result = {
        error: {
          message: `ajvModule "${modulePath}" must export at least one of: \`formats\` (record of format functions, regexes, or ajv FormatDefinition objects) or \`keywords\` (record of ajv KeywordDefinition objects without the \`keyword\` field).`,
        },
      };
    } else {
      result = {
        ...(formats ? { formats } : {}),
        ...(keywords ? { keywords } : {}),
      };
    }
  } catch (error) {
    result = {
      error: {
        message: `Failed to load ajvModule "${modulePath}": ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  ajvModuleCache.set(absolute, result);
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
  keywords: Record<string, SchemaKeyword> | undefined,
  ajvModuleCacheKey: string,
): { schemaRegistry: SchemaRegistry; schemaLoadErrors: ConfigLoadError[] } {
  const key = `${configDir}\0${ajvModuleCacheKey}\0${JSON.stringify(config.customTags ?? [])}`;
  const cached = schemaCache.get(key);
  if (cached) return cached;
  const { registry: schemaRegistry, loadErrors: schemaLoadErrors } =
    loadSchemaRegistry(config.customTags, {
      configDir,
      loadFile: readSchemaFile,
      formats,
      keywords,
    });
  const result = { schemaRegistry, schemaLoadErrors };
  schemaCache.set(key, result);
  return result;
}

/**
 * Load config file for a file:// URI. Returns the parsed config + its
 * containing directory, or null if not found / not parseable.
 *
 * Async because the config's `ajvModule` (if any) is dynamically imported.
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
 * Async because the config's `ajvModule` (if any) is dynamically imported.
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
  let keywords: Record<string, SchemaKeyword> | undefined;
  let ajvModuleKey = '';
  if (config.ajvModule) {
    ajvModuleKey = path.resolve(configDir, config.ajvModule);
    const loaded = await loadAjvModule(configDir, config.ajvModule);
    if (loaded.error) extraLoadErrors.push(loaded.error);
    formats = loaded.formats;
    keywords = loaded.keywords;
  }
  const { schemaRegistry, schemaLoadErrors } = loadSchemasCached(
    config,
    configDir,
    formats,
    keywords,
    ajvModuleKey,
  );
  return {
    ...config,
    config,
    configDir,
    schemaRegistry,
    schemaLoadErrors: [...extraLoadErrors, ...schemaLoadErrors],
  };
}
