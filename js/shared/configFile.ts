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
import { KNOWN_RULE_NAMES } from './ruleMetadata.js';
import type {
  ConfigLoadError,
  SchemaFormat,
  SchemaRegistry,
} from './customTagSchemaLoader.js';
import type { TagValidator } from './tagValidators.js';
import { isSyntacticRuleId } from './tagValidators.js';

const CONFIG_FILENAME = '.htmlmustache.jsonc';

const schemaCache = new Map<
  string,
  { schemaRegistry: SchemaRegistry; schemaLoadErrors: ConfigLoadError[] }
>();

const pluginModuleCache = new Map<string, LoadedPluginModule>();

export interface LoadedPluginModule {
  formats?: Record<string, SchemaFormat>;
  validators?: TagValidator[];
  errors: ConfigLoadError[];
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

function isValidatorDescriptor(value: unknown): value is TagValidator {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    isSyntacticRuleId(v.id) &&
    Array.isArray(v.tags) &&
    v.tags.length > 0 &&
    v.tags.every((tag) => typeof tag === 'string' && tag.length > 0) &&
    (v.severity === undefined ||
      v.severity === 'error' ||
      v.severity === 'warning' ||
      v.severity === 'off') &&
    typeof v.validate === 'function'
  );
}

function validateValidatorsExport(value: unknown): {
  validators: TagValidator[];
  errors: ConfigLoadError[];
} {
  if (!Array.isArray(value)) {
    return {
      validators: [],
      errors: [
        {
          ruleName: 'pluginModule',
          message: '`validators` export must be an array of tag validators.',
        },
      ],
    };
  }
  const validators: TagValidator[] = [];
  const errors: ConfigLoadError[] = [];
  value.forEach((entry, index) => {
    if (!isValidatorDescriptor(entry)) {
      errors.push({
        ruleName: 'pluginModule',
        message: `Invalid validator descriptor at validators[${index}].`,
      });
      return;
    }
    validators.push({
      ...entry,
      tags: entry.tags.map((tag) => tag.toLowerCase()),
    });
  });
  const counts = new Map<string, number>();
  for (const validator of validators) {
    counts.set(validator.id, (counts.get(validator.id) ?? 0) + 1);
  }
  const conflicting = new Set<string>();
  for (const [id, count] of counts) {
    if (count > 1 || KNOWN_RULE_NAMES.has(id)) {
      conflicting.add(id);
      errors.push({
        ruleName: 'pluginModule',
        message: KNOWN_RULE_NAMES.has(id)
          ? `Validator id "${id}" conflicts with a built-in rule name.`
          : `Duplicate validator id "${id}".`,
      });
    }
  }
  const filtered = validators.filter(
    (validator) => !conflicting.has(validator.id),
  );
  return { validators: filtered, errors };
}

/**
 * Dynamically import the module referenced by `pluginModule`. The module may
 * expose `formats` and/or synchronous custom-tag `validators`.
 * Cached per absolute path.
 *
 * A module that supplies only one of the two is fine — the other simply
 * isn't registered.
 */
export async function loadPluginModule(
  configDir: string,
  modulePath: string,
): Promise<LoadedPluginModule> {
  const absolute = path.resolve(configDir, modulePath);
  const cached = pluginModuleCache.get(absolute);
  if (cached) return cached;
  let result: LoadedPluginModule;
  try {
    const mod = (await import(pathToFileURL(absolute).href)) as Record<
      string,
      unknown
    >;
    const errors: ConfigLoadError[] = [];
    let formats: Record<string, SchemaFormat> | undefined;
    let validators: TagValidator[] | undefined;
    if ('formats' in mod) {
      formats = validateFormatsExport(mod.formats) ?? undefined;
      if (!formats) {
        errors.push({
          ruleName: 'pluginModule',
          message:
            '`formats` export must be a record of AJV format functions, regexes, or format definitions.',
        });
      }
    }
    if ('validators' in mod) {
      const validated = validateValidatorsExport(mod.validators);
      validators = validated.validators;
      errors.push(...validated.errors);
    }
    if (!formats && (!validators || validators.length === 0)) {
      errors.push({
        ruleName: 'pluginModule',
        message: `pluginModule "${modulePath}" must export at least one valid extension: \`formats\` or \`validators\`.`,
      });
    }
    result = {
      ...(formats ? { formats } : {}),
      ...(validators && validators.length > 0 ? { validators } : {}),
      errors,
    };
  } catch (error) {
    result = {
      errors: [
        {
          ruleName: 'pluginModule',
          message: `Failed to load pluginModule "${modulePath}": ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  pluginModuleCache.set(absolute, result);
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
  validators: TagValidator[];
}

function readSchemaFile(schemaPath: string, configDir: string): unknown {
  const resolved = path.resolve(configDir, schemaPath);
  return parseJsonc(fs.readFileSync(resolved, 'utf-8'));
}

function loadSchemasCached(
  config: HtmlMustacheConfig,
  configDir: string,
  formats: Record<string, SchemaFormat> | undefined,
  pluginModuleCacheKey: string,
): { schemaRegistry: SchemaRegistry; schemaLoadErrors: ConfigLoadError[] } {
  const key = `${configDir}\0${pluginModuleCacheKey}\0${JSON.stringify(config.customTags ?? [])}`;
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
 * Async because the config's `pluginModule` (if any) is dynamically imported.
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
 * Async because the config's `pluginModule` (if any) is dynamically imported.
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
  let validators: TagValidator[] = [];
  let pluginModuleKey = '';
  if (config.pluginModule) {
    pluginModuleKey = path.resolve(configDir, config.pluginModule);
    const loaded = await loadPluginModule(configDir, config.pluginModule);
    extraLoadErrors.push(...loaded.errors);
    formats = loaded.formats;
    validators = loaded.validators ?? [];
  }
  const { schemaRegistry, schemaLoadErrors } = loadSchemasCached(
    config,
    configDir,
    formats,
    pluginModuleKey,
  );
  return {
    ...config,
    config,
    configDir,
    schemaRegistry,
    schemaLoadErrors: [...extraLoadErrors, ...schemaLoadErrors],
    validators,
  };
}
