import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatParamsFromConfig } from '../../../js/formatter/mergeOptions.js';
import { filterCustomRulesForPath } from '../../../js/linter/customRuleFilter.js';
import {
  collectCustomTagNames,
  type CustomCodeTagConfig,
} from '../../../js/shared/customCodeTags.js';
import { loadConfigFile } from '../../../js/shared/configFile.js';
import type {
  CustomRule,
  HtmlMustacheConfig,
} from '../../../js/shared/configSchema.js';
import type { FormatDocumentParams } from '../../../js/formatter/document.js';
import type {
  ConfigLoadError,
  SchemaRegistry,
} from '../../../js/shared/customTagSchemaLoader.js';
import type { TagValidator } from '../../../js/shared/tagValidators.js';

export interface DocumentConfig {
  config: HtmlMustacheConfig | null;
  configDir: string | null;
  customTags: CustomCodeTagConfig[];
  customTagNames: string[];
  customRules: CustomRule[] | undefined;
  formatParams: FormatDocumentParams;
  schemaRegistry: SchemaRegistry | undefined;
  schemaLoadErrors: ConfigLoadError[] | undefined;
  validators: TagValidator[];
}

function applicableCustomRules(
  uri: string,
  config: HtmlMustacheConfig | null,
  configDir: string | null,
): CustomRule[] | undefined {
  if (!config?.customRules || !configDir || !uri.startsWith('file://')) {
    return config?.customRules;
  }
  try {
    const filePath = fileURLToPath(uri);
    const rel = path.relative(configDir, filePath) || filePath;
    return filterCustomRulesForPath(config.customRules, rel);
  } catch {
    return config.customRules;
  }
}

export async function resolveDocumentConfig(
  uri: string,
): Promise<DocumentConfig> {
  const loaded = await loadConfigFile(uri);
  const config = loaded?.config ?? null;
  const configDir = loaded?.configDir ?? null;
  const customTags = config?.customTags ?? [];

  return {
    config,
    configDir,
    customTags,
    customTagNames: collectCustomTagNames(customTags) ?? [],
    customRules: applicableCustomRules(uri, config, configDir),
    formatParams: {
      ...formatParamsFromConfig(config, {}),
      customTags,
    },
    schemaRegistry: loaded?.schemaRegistry,
    schemaLoadErrors: loaded?.schemaLoadErrors,
    validators: loaded?.validators ?? [],
  };
}
