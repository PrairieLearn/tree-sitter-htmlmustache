/**
 * Node-only configuration discovery helpers.
 *
 * Pure schema types + parseJsonc + validateConfig live in
 * `src/core/configSchema.ts` and are the browser-safe surface.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { parseJsonc, validateConfig } from '../../../src/core/configSchema.js';
import type { HtmlMustacheConfig } from '../../../src/core/configSchema.js';
import { loadSchemaRegistry } from '../../../src/core/customTagSchemaLoader.js';
import type { ConfigLoadError, SchemaRegistry } from '../../../src/core/customTagSchemaLoader.js';

const CONFIG_FILENAME = '.htmlmustache.jsonc';

const schemaCache = new Map<string, { schemaRegistry: SchemaRegistry; schemaLoadErrors: ConfigLoadError[] }>();

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

function loadSchemasCached(config: HtmlMustacheConfig, configDir: string): { schemaRegistry: SchemaRegistry; schemaLoadErrors: ConfigLoadError[] } {
  const key = `${configDir}\0${JSON.stringify(config.customTags ?? [])}`;
  const cached = schemaCache.get(key);
  if (cached) return cached;
  const { registry: schemaRegistry, loadErrors: schemaLoadErrors } = loadSchemaRegistry(config.customTags, {
    configDir,
    loadFile: readSchemaFile,
  });
  const result = { schemaRegistry, schemaLoadErrors };
  schemaCache.set(key, result);
  return result;
}

/**
 * Load config file for a file:// URI. Returns the parsed config + its
 * containing directory, or null if not found / not parseable.
 */
export function loadConfigFile(uri: string): LoadedConfig | null {
  if (!uri.startsWith('file://')) return null;
  try {
    const filePath = fileURLToPath(uri);
    return loadConfigFileForPath(filePath);
  } catch {
    return null;
  }
}

/**
 * Load config file for a filesystem path. Returns the parsed config + its
 * containing directory, or null.
 */
export function loadConfigFileForPath(filePath: string): LoadedConfig | null {
  const dir = path.dirname(path.resolve(filePath));
  const configPath = findConfigFile(dir);
  if (!configPath) return null;
  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    const raw = parseJsonc(text);
    const config = validateConfig(raw);
    const configDir = path.dirname(configPath);
    const { schemaRegistry, schemaLoadErrors } = loadSchemasCached(config, configDir);
    return { ...config, config, configDir, schemaRegistry, schemaLoadErrors };
  } catch {
    return null;
  }
}
