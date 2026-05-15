# Boolean Custom Tag Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `customTagDefaults.allowBooleanAttributes` plus per-tag overrides so custom tag validation can reject HTML boolean attributes while preserving the current default.

**Architecture:** Keep the parser unchanged and implement this entirely in the custom tag config/schema validation layer. Config parsing records the option, `loadSchemaRegistry()` resolves it into top-level and parent-owned child tag metadata, and `checkCustomTagSchemas()` emits `customTagSchema` diagnostics anchored to boolean attributes.

**Tech Stack:** TypeScript, Zod, AJV, Vitest, generated JSON Schema via `scripts/generate-config-schema.ts`.

---

## File Structure

- Modify `js/shared/customCodeTags.ts`: add the public config fields to custom tag and child tag interfaces.
- Modify `js/shared/configSchema.ts`: parse and validate `customTagDefaults.allowBooleanAttributes` and per-tag overrides.
- Modify `schemas/htmlmustache-config.schema.json`: regenerate from the Zod schema.
- Modify `js/shared/configSchemaJson.test.ts`: extend representative config coverage.
- Modify `js/shared/customTagSchemaLoader.ts`: resolve the option into registry metadata.
- Modify `js/linter/customTagSchemaChecker.ts`: report boolean attribute diagnostics and suppress duplicate type errors for the same attribute.
- Modify `js/linter/index.ts`, `js/cli/check.ts`, and `js/shared/configFile.ts`: pass `customTagDefaults` into `loadSchemaRegistry()`.
- Modify `js/shared/tagValidators.ts`: make `TagElement` generic so `TagElement<false>` narrows attribute values to strings.
- Modify `js/linter/linter.test.ts`: add runtime linter coverage.
- Modify `js/shared/tagValidators.type.test.ts`: add type-focused assertions for the generic `TagElement` contract.
- Modify `README.md`: document the new option near custom tag schemas.

---

### Task 1: Config Types And Zod Schema

**Files:**
- Modify: `js/shared/customCodeTags.ts`
- Modify: `js/shared/configSchema.ts`
- Modify: `js/shared/configSchemaJson.test.ts`
- Generate: `schemas/htmlmustache-config.schema.json`

- [ ] **Step 1: Add a failing config schema test**

In `js/shared/configSchemaJson.test.ts`, extend the representative config object inside `validates a representative .htmlmustache.jsonc config shape`:

```ts
customTagDefaults: {
  allowBooleanAttributes: false,
},
customTags: [
  {
    name: 'pl-multiple-choice',
    allowBooleanAttributes: true,
    display: 'block',
    languageDefault: 'html',
    languageAttribute: 'language',
    languageMap: { python3: 'python' },
    indent: 'attribute',
    indentAttribute: 'source-file-name',
    schema: {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: {
        'answers-name': { type: 'string' },
      },
      required: ['answers-name'],
      additionalProperties: false,
    },
    children: [
      {
        name: 'pl-answer',
        allowBooleanAttributes: false,
        schema: 'elements/pl-answer.schema.json',
        children: [{ name: 'pl-answer-feedback' }],
      },
    ],
    allowAdditionalChildren: true,
  },
],
```

Add a new rejection assertion in `rejects misspelled top-level keys` or a new test directly after it:

```ts
it('rejects non-boolean custom tag boolean-attribute options', () => {
  const validate = compileConfigSchema();

  expect(
    validate({
      customTagDefaults: { allowBooleanAttributes: 'no' },
    }),
  ).toBe(false);

  expect(
    validate({
      customTags: [{ name: 'pl-card', allowBooleanAttributes: 'no' }],
    }),
  ).toBe(false);
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm run test:js -- js/shared/configSchemaJson.test.ts
```

Expected: FAIL because `customTagDefaults` and `allowBooleanAttributes` are not in the generated config schema yet.

- [ ] **Step 3: Add public config fields**

In `js/shared/customCodeTags.ts`, update the interfaces:

```ts
export interface ChildTagConfig {
  name: string;
  schema?: SchemaRef;
  children?: ChildTagConfig[];
  allowAdditionalChildren?: boolean;
  allowBooleanAttributes?: boolean;
}

export interface CustomCodeTagConfig {
  name: string;
  display?: CSSDisplay;
  languageAttribute?: string;
  languageMap?: Record<string, string>;
  languageDefault?: string;
  indent?: CustomCodeTagIndentMode;
  indentAttribute?: string;
  schema?: SchemaRef;
  children?: ChildTagConfig[];
  allowAdditionalChildren?: boolean;
  allowBooleanAttributes?: boolean;
}
```

In `js/shared/configSchema.ts`, add the defaults interface:

```ts
export interface CustomTagDefaults {
  allowBooleanAttributes?: boolean;
}
```

Update `HtmlMustacheConfig`:

```ts
export interface HtmlMustacheConfig {
  printWidth?: number;
  indentSize?: number;
  mustacheSpaces?: boolean;
  noBreakDelimiters?: NoBreakDelimiter[];
  customTagDefaults?: CustomTagDefaults;
  customTags?: CustomCodeTagConfig[];
  include?: string[];
  exclude?: string[];
  rules?: RulesConfig;
  customRules?: CustomRule[];
  pluginModule?: string;
}
```

Add the Zod schema and wire it into child, tag, and root schemas:

```ts
const customTagDefaultsSchema = z
  .object({
    allowBooleanAttributes: z.boolean().optional(),
  })
  .strict();
```

Add `allowBooleanAttributes: z.boolean().optional()` to both `childTagSchema` and `customTagSchema`, and add `customTagDefaults: customTagDefaultsSchema.optional()` to `htmlMustacheConfigSchema`.

Update lenient parsing:

```ts
const allowBooleanAttributes = z
  .boolean()
  .safeParse(e.allowBooleanAttributes);
if (allowBooleanAttributes.success) {
  tag.allowBooleanAttributes = allowBooleanAttributes.data;
}
```

Add that block in both `parseChildTags()` and `parseCustomTags()`.

In `validateConfig()`, parse the defaults before `customTags`:

```ts
const customTagDefaults = customTagDefaultsSchema.safeParse(
  obj.customTagDefaults,
);
if (customTagDefaults.success) {
  config.customTagDefaults = customTagDefaults.data;
}
```

- [ ] **Step 4: Regenerate the config JSON Schema**

Run:

```bash
npm run generate:config-schema
```

Expected: `schemas/htmlmustache-config.schema.json` is rewritten and contains `customTagDefaults` plus `allowBooleanAttributes`.

- [ ] **Step 5: Run the config tests**

Run:

```bash
npm run test:js -- js/shared/configSchemaJson.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit config changes**

Run:

```bash
git add js/shared/customCodeTags.ts js/shared/configSchema.ts js/shared/configSchemaJson.test.ts schemas/htmlmustache-config.schema.json
git commit -m "feat: add boolean attribute config"
```

---

### Task 2: Registry Metadata And Callers

**Files:**
- Modify: `js/shared/customTagSchemaLoader.ts`
- Modify: `js/linter/index.ts`
- Modify: `js/cli/check.ts`
- Modify: `js/shared/configFile.ts`

- [ ] **Step 1: Add failing linter tests for option propagation**

In `js/linter/linter.test.ts`, add this test in `describe('draft-06 flat custom tag schemas', ...)`:

```ts
it('allows boolean attributes by default but rejects them when custom tag defaults opt out', () => {
  const defaultResult = linter
    .lint('<pl-answer correct></pl-answer>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-answer' }],
    })
    .filter((x) => x.ruleName === 'customTagSchema');
  expect(defaultResult).toEqual([]);

  const disabled = linter
    .lint('<pl-answer correct></pl-answer>', {
      rules: { customTagSchema: 'error' },
      customTagDefaults: { allowBooleanAttributes: false },
      customTags: [{ name: 'pl-answer' }],
    })
    .filter((x) => x.ruleName === 'customTagSchema');
  expect(disabled.map((x) => x.message)).toEqual([
    'Attribute "correct" on <pl-answer> must have a value.',
  ]);
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm run test:js -- js/linter/linter.test.ts
```

Expected: FAIL because `customTagDefaults` is not yet propagated into the schema registry and no diagnostic is emitted.

- [ ] **Step 3: Extend registry types**

In `js/shared/customTagSchemaLoader.ts`, update imports:

```ts
import type {
  ChildTagConfig,
  CustomTagConfig,
  SchemaRef,
} from './customCodeTags.js';
import type { CustomTagDefaults } from './configSchema.js';
```

Add:

```ts
export interface TagValidationOptions {
  allowBooleanAttributes: boolean;
}
```

Update registry-facing interfaces:

```ts
export interface CompiledTagSchema {
  tagName: string;
  schema: Record<string, unknown>;
  validate: ValidateFunction;
}

export interface CompiledChildTagConfig extends TagValidationOptions {
  tagName: string;
  schema?: CompiledTagSchema;
  children?: ChildTagSchemaConfig;
}

export interface SchemaRegistry {
  schemas: Map<string, CompiledTagSchema>;
  children: Map<string, ChildTagSchemaConfig>;
  topLevelTags: Set<string>;
  childParents: Map<string, Set<string>>;
  tagOptions: Map<string, TagValidationOptions>;
}

export interface SchemaLoadOptions {
  configDir?: string;
  loadFile?: (schemaPath: string, configDir: string) => unknown;
  formats?: Record<string, SchemaFormat>;
  customTagDefaults?: CustomTagDefaults;
}
```

- [ ] **Step 4: Resolve options during registry load**

In `js/shared/customTagSchemaLoader.ts`, add:

```ts
function resolveAllowBooleanAttributes(
  value: boolean | undefined,
  defaults: CustomTagDefaults | undefined,
): boolean {
  return value ?? defaults?.allowBooleanAttributes ?? true;
}
```

Update `compileChildTag()`:

```ts
const compiled: CompiledChildTagConfig = {
  tagName: childTagName,
  allowBooleanAttributes: resolveAllowBooleanAttributes(
    child.allowBooleanAttributes,
    options.customTagDefaults,
  ),
};
```

Update the `registry` initializer in `loadSchemaRegistry()`:

```ts
const registry: SchemaRegistry = {
  schemas: new Map(),
  children: new Map(),
  topLevelTags: new Set(),
  childParents: new Map(),
  tagOptions: new Map(),
};
```

Inside the top-level tag loop, after `registry.topLevelTags.add(tagName)`:

```ts
registry.tagOptions.set(tagName, {
  allowBooleanAttributes: resolveAllowBooleanAttributes(
    tag.allowBooleanAttributes,
    options.customTagDefaults,
  ),
});
```

- [ ] **Step 5: Pass defaults from every registry caller**

In `js/linter/index.ts`, update the `loadSchemaRegistry()` call:

```ts
const schemaResult = loadSchemaRegistry(
  stripFilesystemSchemas(config?.customTags),
  {
    formats,
    customTagDefaults: config?.customTagDefaults,
  },
);
```

In `js/shared/configFile.ts`, update `loadSchemasCached()`:

```ts
const { registry: schemaRegistry, loadErrors: schemaLoadErrors } =
  loadSchemaRegistry(config.customTags, {
    configDir,
    loadFile: readSchemaFile,
    formats,
    customTagDefaults: config.customTagDefaults,
  });
```

In `js/cli/check.ts`, update each `loadSchemaRegistry(config.customTags, { ... })` call to include:

```ts
customTagDefaults: config.customTagDefaults,
```

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit registry propagation**

Run:

```bash
git add js/shared/customTagSchemaLoader.ts js/linter/index.ts js/cli/check.ts js/shared/configFile.ts js/linter/linter.test.ts
git commit -m "feat: propagate custom tag boolean attribute defaults"
```

---

### Task 3: Boolean Attribute Diagnostics

**Files:**
- Modify: `js/linter/customTagSchemaChecker.ts`
- Modify: `js/linter/linter.test.ts`

- [ ] **Step 1: Add focused failing diagnostics tests**

Add these tests to `describe('draft-06 flat custom tag schemas', ...)`:

```ts
it('lets top-level tags override boolean attribute defaults in either direction', () => {
  const optedIn = linter
    .lint('<pl-answer correct></pl-answer>', {
      rules: { customTagSchema: 'error' },
      customTagDefaults: { allowBooleanAttributes: false },
      customTags: [{ name: 'pl-answer', allowBooleanAttributes: true }],
    })
    .filter((x) => x.ruleName === 'customTagSchema');
  expect(optedIn).toEqual([]);

  const optedOut = linter
    .lint('<pl-answer correct></pl-answer>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-answer', allowBooleanAttributes: false }],
    })
    .filter((x) => x.ruleName === 'customTagSchema');
  expect(optedOut.map((x) => x.message)).toEqual([
    'Attribute "correct" on <pl-answer> must have a value.',
  ]);
});

it('applies child-specific boolean attribute options in parent-owned contexts', () => {
  const diagnostics = linter
    .lint(
      '<pl-multiple-choice><pl-answer correct></pl-answer></pl-multiple-choice><pl-order-blocks><pl-answer correct></pl-answer></pl-order-blocks>',
      {
        rules: { customTagSchema: 'error', unrecognizedHtmlTags: 'off' },
        customTagDefaults: { allowBooleanAttributes: true },
        customTags: [
          {
            name: 'pl-multiple-choice',
            children: [{ name: 'pl-answer', allowBooleanAttributes: false }],
          },
          {
            name: 'pl-order-blocks',
            children: [{ name: 'pl-answer', allowBooleanAttributes: true }],
          },
        ],
      },
    )
    .filter((x) => x.ruleName === 'customTagSchema');

  expect(diagnostics.map((x) => x.message)).toEqual([
    'Attribute "correct" on <pl-answer> inside <pl-multiple-choice> must have a value.',
  ]);
});

it('does not reject valued literal or dynamic valued attributes when boolean attributes are disabled', () => {
  const diagnostics = linter
    .lint(
      '<pl-answer correct="true"></pl-answer><pl-answer correct="{{value}}"></pl-answer>',
      {
        rules: { customTagSchema: 'error' },
        customTagDefaults: { allowBooleanAttributes: false },
        customTags: [{ name: 'pl-answer' }],
      },
    )
    .filter((x) => x.ruleName === 'customTagSchema');

  expect(diagnostics).toEqual([]);
});

it('anchors boolean attribute diagnostics to the offending attribute', () => {
  const diagnostics = linter
    .lint('<pl-answer\n  correct></pl-answer>', {
      rules: { customTagSchema: 'error' },
      customTagDefaults: { allowBooleanAttributes: false },
      customTags: [{ name: 'pl-answer' }],
    })
    .filter((x) => x.ruleName === 'customTagSchema');

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].line).toBe(2);
  expect(diagnostics[0].column).toBe(3);
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm run test:js -- js/linter/linter.test.ts
```

Expected: FAIL because `checkCustomTagSchemas()` does not emit boolean attribute diagnostics yet.

- [ ] **Step 3: Add boolean attribute helpers**

In `js/linter/customTagSchemaChecker.ts`, add this helper near `tagContext()`:

```ts
function booleanAttributeMessage(
  attribute: string,
  tag: string,
  parentTag?: string,
): string {
  return `Attribute "${attribute}" on ${tagContext(tag, parentTag)} must have a value.`;
}
```

Add helpers after `buildAttributeObject()`:

```ts
function booleanAttributeNames(context: ElementContext): Set<string> {
  const names = new Set<string>();
  for (const [name, info] of context.attributesByName) {
    if (info.value === true) names.add(name);
  }
  return names;
}

function checkBooleanAttributes(
  element: BalanceNode,
  allowBooleanAttributes: boolean,
  parentTag?: string,
): { errors: FixableError[]; names: Set<string> } {
  const tag = getTagName(element)?.toLowerCase();
  const built = buildAttributeObject(element);
  if (!tag || !built || allowBooleanAttributes) {
    return { errors: [], names: new Set() };
  }

  const names = booleanAttributeNames(built.context);
  const errors: FixableError[] = [];
  for (const name of names) {
    const attr = built.context.attributesByName.get(name);
    if (!attr) continue;
    errors.push({
      node: attr.attrNode,
      message: booleanAttributeMessage(name, tag, parentTag),
    });
  }
  return { errors, names };
}
```

- [ ] **Step 4: Suppress duplicate schema type errors for rejected boolean attributes**

Change `validateElement()` signature:

```ts
function validateElement(
  compiled: CompiledTagSchema,
  element: BalanceNode,
  parentTag?: string,
  rejectedBooleanAttributes = new Set<string>(),
): FixableError[] {
```

Filter AJV errors with the rejected names:

```ts
const errors = compiled.validate.errors.filter((error) => {
  if (mentionsDynamicAttribute(error, built.context, compiled.schema)) {
    return false;
  }
  const attrName = attributeNameForError(error);
  return !(
    error.keyword === 'type' &&
    attrName !== null &&
    rejectedBooleanAttributes.has(attrName)
  );
});
```

- [ ] **Step 5: Apply effective options in the visitor**

In `checkCustomTagSchemas()`, add:

```ts
const tagOptions = registry.tagOptions;
```

Inside `visit()` after `const tag = getTagName(node)?.toLowerCase();`, compute:

```ts
const effectiveAllowBooleanAttributes =
  scopedConfig?.allowBooleanAttributes ??
  (tag ? tagOptions.get(tag)?.allowBooleanAttributes : undefined) ??
  true;
const booleanCheck = checkBooleanAttributes(
  node,
  effectiveAllowBooleanAttributes,
  scopedConfig ? directParentTag : undefined,
);
errors.push(...booleanCheck.errors);
```

Update top-level schema validation:

```ts
const compiled = tag ? schemas.get(tag) : undefined;
if (compiled) {
  errors.push(
    ...validateElement(
      compiled,
      node,
      undefined,
      booleanCheck.names,
    ),
  );
}
```

Update parent-owned child schema validation inside the direct child loop:

```ts
if (childEntry.schema) {
  const childBooleanCheck = checkBooleanAttributes(
    child,
    childEntry.allowBooleanAttributes,
    tag,
  );
  errors.push(
    ...validateElement(
      childEntry.schema,
      child,
      tag,
      childBooleanCheck.names,
    ),
  );
}
```

Do not push `childBooleanCheck.errors` in the direct child loop because the recursive `visit(child, tag, childEntry, childConfig)` path emits the boolean attribute diagnostic once with the same parent context.

- [ ] **Step 6: Run linter tests**

Run:

```bash
npm run test:js -- js/linter/linter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit diagnostics**

Run:

```bash
git add js/linter/customTagSchemaChecker.ts js/linter/linter.test.ts
git commit -m "feat: reject custom tag boolean attributes"
```

---

### Task 4: Validator Type Narrowing

**Files:**
- Modify: `js/shared/tagValidators.ts`
- Create: `js/shared/tagValidators.type.test.ts`

- [ ] **Step 1: Add type-focused failing coverage**

Create `js/shared/tagValidators.type.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { TagElement } from './tagValidators.js';

describe('TagElement boolean attribute type narrowing', () => {
  it('keeps boolean attributes in the default public shape', () => {
    const element = undefined as unknown as TagElement;

    expectTypeOf(element.attributes.correct).toEqualTypeOf<string | true>();
    expectTypeOf(element.getAttribute('correct')).toEqualTypeOf<
      string | true | undefined
    >();
    expectTypeOf(element.getLiteralAttribute('correct')).toEqualTypeOf<
      string | true | undefined
    >();
    expect(true).toBe(true);
  });

  it('narrows attributes to strings when boolean attributes are disabled', () => {
    const element = undefined as unknown as TagElement<false>;

    expectTypeOf(element.attributes.correct).toEqualTypeOf<string>();
    expectTypeOf(element.getAttribute('correct')).toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf(element.getLiteralAttribute('correct')).toEqualTypeOf<
      string | undefined
    >();
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the type test and verify it fails**

Run:

```bash
npm run test:js -- js/shared/tagValidators.type.test.ts
```

Expected: FAIL because `TagElement` does not accept a type parameter yet.

- [ ] **Step 3: Make `TagElement` generic**

In `js/shared/tagValidators.ts`, add:

```ts
export type AttributeValue = string | true;
export type AttributeValueFor<
  TAllowBooleanAttributes extends boolean,
> = TAllowBooleanAttributes extends false ? string : AttributeValue;
```

Update `TagElement`:

```ts
export interface TagElement<
  TAllowBooleanAttributes extends boolean = true,
> {
  readonly tag: string;
  readonly attributes: Readonly<
    Record<string, AttributeValueFor<TAllowBooleanAttributes>>
  >;
  readonly children: readonly TagElement[];
  readonly innerHtml?: string;
  hasAttribute(name: string): boolean;
  getAttribute(
    name: string,
  ): AttributeValueFor<TAllowBooleanAttributes> | undefined;
  getLiteralAttribute(
    name: string,
  ): AttributeValueFor<TAllowBooleanAttributes> | undefined;
  isAttributeDynamic(name: string): boolean;
  childrenWithTag(tag: string): readonly TagElement[];
  childrenWithoutTag(tag: string): readonly TagElement[];
}
```

Keep `TagValidatorFn`, `TagValidatorRule`, and `TagValidator` using plain `TagElement` so existing validators stay source-compatible.

- [ ] **Step 4: Run type and runtime checks**

Run:

```bash
npm run test:js -- js/shared/tagValidators.type.test.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit type narrowing**

Run:

```bash
git add js/shared/tagValidators.ts js/shared/tagValidators.type.test.ts
git commit -m "feat: narrow tag validator attribute values"
```

---

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-15-valueless-custom-tag-attributes-design.md`

- [ ] **Step 1: Update README custom tag schema documentation**

In `README.md`, near the paragraph that describes attributes represented as `true`, add:

````md
HTML boolean attributes are allowed on custom tags by default, matching existing behavior:

```html
<pl-answer correct></pl-answer>
```

For projects whose custom elements require explicit values, disable boolean attributes for all custom tags and opt individual tags back in when needed:

```jsonc
{
  "customTagDefaults": {
    "allowBooleanAttributes": false
  },
  "customTags": [
    {
      "name": "pl-answer",
      "allowBooleanAttributes": true
    }
  ]
}
```

When disabled, `<pl-answer correct>` reports `Attribute "correct" on <pl-answer> must have a value.`. The option applies only to configured custom tags; ordinary HTML boolean attributes such as `<input disabled>` are not affected.
````

- [ ] **Step 2: Rename the spec file to match final terminology**

Run:

```bash
git mv docs/superpowers/specs/2026-05-15-valueless-custom-tag-attributes-design.md docs/superpowers/specs/2026-05-15-boolean-custom-tag-attributes-design.md
```

No content change is needed unless the implementation diverged from the design.

- [ ] **Step 3: Run generated schema sync test**

Run:

```bash
npm run test:js -- js/shared/configSchemaJson.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full JS tests and typecheck**

Run:

```bash
npm run test:js
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 5: Run lint if dependencies are installed**

Run:

```bash
npm run lint
```

Expected: PASS. If lint fails because dependencies are missing or the environment cannot run ESLint, capture the exact failure in the final implementation notes.

- [ ] **Step 6: Commit docs and final verification updates**

Run:

```bash
git add README.md docs/superpowers/specs/2026-05-15-boolean-custom-tag-attributes-design.md
git commit -m "docs: document custom tag boolean attributes"
```

---

## Self-Review

- Spec coverage: every requirement in the approved design maps to a task: config shape in Task 1, inheritance and propagation in Task 2, diagnostics in Task 3, TypeScript narrowing in Task 4, and README/spec updates in Task 5.
- Placeholder scan: no deferred placeholders remain in this plan.
- Type consistency: the chosen public option name is `allowBooleanAttributes` everywhere; the inherited default container is `customTagDefaults`; the public narrowing type is `TagElement<false>`.
