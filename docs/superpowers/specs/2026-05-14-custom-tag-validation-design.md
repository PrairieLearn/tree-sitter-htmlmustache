# Custom Tag Validation Design

Date: 2026-05-14

Decision record: [ADR 0001: Use Attribute Schemas and Tag Validators for Custom Tag Validation](../../adr/0001-attribute-schemas-and-tag-validators.md)

## Context

`tree-sitter-htmlmustache` currently supports custom tag validation through JSON Schema draft 2020-12. The validated value is an element envelope containing `tag`, `attributes`, `text`, `innerHtml`, and one level of `children`. The current implementation also supports custom AJV formats, custom AJV keywords, `htmlGlobalAttributes`, schema-based parent/child constraints, and schema-backed deprecation diagnostics.

That feature set is too broad for the intended boundary. JSON Schema is useful for simple, reusable attribute validation, but it is a poor fit for PrairieLearn-style rules that need to inspect children, content, ordering, or cross-element relationships. Those rules should be ordinary JavaScript validation functions with stable lint rule ids.

This design is a hard breaking change. It does not preserve `ajvModule`, draft 2020-12, custom AJV keywords, schema-visible children/content, or the old element-envelope schema shape.

## Goals

- Make custom tag schemas small and attribute-focused.
- Move complex tag validation into synchronous JavaScript validators.
- Keep custom schema formats for reusable attribute value checks.
- Give validators stable rule ids that integrate with existing rule severity configuration and inline disables.
- Keep the public API simple enough for current PrairieLearn element validation while leaving room for future plugin exports.

## Non-Goals

- No backwards-compatible alias for `ajvModule`.
- No migration diagnostics for old schema features.
- No custom AJV keyword support.
- No schema support for child elements, text content, or inner HTML.
- No document-wide validator API in this iteration.
- No asynchronous validators.

## Schema Contract

Each custom tag schema validates only the **attribute shape**: the flat attributes object for the tag bound by `customTags[].name`. The tag name is implicit and is not part of the schema input.

Example:

```json
{
  "$schema": "http://json-schema.org/draft-06/schema#",
  "type": "object",
  "properties": {
    "answers-name": { "type": "string" },
    "weight": { "type": "number", "minimum": 0 }
  },
  "required": ["answers-name"],
  "additionalProperties": false
}
```

The schema input for:

```html
<pl-example answers-name="q1" disabled weight="2"></pl-example>
```

is:

```json
{
  "answers-name": "q1",
  "disabled": true,
  "weight": "2"
}
```

Kept behavior:

- JSON Schema draft-06.
- Schemas must declare draft-06 with the official metaschema URI. `http` and `https`, with or without a trailing `#`, are accepted.
- Standard JSON Schema validation, including `type`, `properties`, `required`, `additionalProperties`, `enum`, `const`, `pattern`, numeric bounds, and `format`.
- AJV type coercion for attribute values.
- Valueless attributes are represented as `true`.
- Dynamic attributes are treated as unknown runtime values for value-dependent checks, while structural checks such as required and unknown attributes still run.
- Custom formats can be registered by project code.

Dropped behavior:

- Draft 2020-12.
- The element envelope with `tag`, `attributes`, `children`, `text`, and `innerHtml`.
- `htmlGlobalAttributes`.
- Custom AJV keywords.
- Schema-authored parent/child constraints.

## Plugin Module

`.htmlmustache.jsonc` uses `pluginModule` to load executable project code:

```jsonc
{
  "pluginModule": "./scripts/htmlmustache-plugin.mjs"
}
```

The module may export `formats` and `validators`:

```js
export const formats = {
  'pl-boolean': (value) => typeof value === 'string' && isPlBoolean(value),
};

export const validators = [
  {
    id: 'pl/order-blocks-children',
    tags: ['pl-order-blocks'],
    severity: 'error',
    validate(element, context) {
      context.report({
        element,
        message: '<pl-order-blocks> has invalid children.',
      });
    },
  },
];
```

`formats` are registered with AJV before schema compilation. `validators` are synchronous tag validators. The module name is intentionally broader than validation so future exports can be added without renaming the config field.

`ajvModule` is removed. A module export named `keywords` is not accepted or registered.

Programmatic users can also pass validators directly:

```ts
const linter = await createLinter({
  locateWasm,
  formats,
  validators,
});
```

This mirrors the existing programmatic `formats` path and keeps browser-safe integrations from depending on filesystem module loading.

When programmatic validators and `pluginModule` validators are both present, they are combined. Duplicate ids across the combined validator set are reported as plugin/config load diagnostics. Programmatic formats and `pluginModule` formats are also combined; duplicate format names are load errors.

## Validator API

A validator is a descriptor:

```ts
interface TagValidator {
  id: string;
  tags: string[];
  severity?: 'error' | 'warning' | 'off';
  validate(element: TagElement, context: ValidatorContext): void;
}
```

`tags` is a required non-empty array of tag names that receive the validator. Tags are normalized to lowercase for matching. Multiple validators can target the same tag, and one validator can target multiple tags. There is no wildcard or document-wide validator in this iteration.

Validators run only for matching tags that are also declared in `customTags[]`. `customTags[]` remains the project registry of known custom tags; the plugin does not activate validation for undeclared tags by itself.

Validators are independent of `customTagSchema`. They still run when schema validation is disabled, as long as their own effective severity is not `off`.

Validator ids must be globally unique across all loaded validators. Duplicate ids and collisions with built-in rule names are plugin/config load diagnostics because severity configuration and inline disables use the id as the rule identity. Ids must be non-empty strings without whitespace or commas. A namespace slash, such as `pl/order-blocks-children`, is recommended but not required.

The tag element passed to validators is a facade over the parsed tree:

```ts
interface TagElement {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string | true>>;
  readonly children: readonly TagElement[];
  hasDynamicAttribute(name: string): boolean;
}
```

`children` contains all direct child HTML elements, including ordinary HTML tags and configured custom tags. Mustache sections are transparent for child collection, matching max-set semantics. The initial API is one level deep: child elements are useful diagnostic targets and expose their own tag and attributes, but their `children` arrays are empty.

Attribute values are raw source values, except valueless attributes are represented as `true`. Dynamic attributes are not replaced with schema sentinels for validators. Validators that usually cannot reason about runtime values can call `element.hasDynamicAttribute(name)` and skip that check. `hasDynamicAttribute` is AST-based: it returns `true` when the parsed attribute value contains a mustache construct.

The context exposes diagnostic reporting:

```ts
interface ValidatorContext {
  report(diagnostic: {
    element: TagElement;
    attribute?: string;
    message: string;
  }): void;
}
```

Diagnostics use the validator's effective severity. Reports anchor to the element start tag by default. If `attribute` is provided and that attribute exists on the element, the diagnostic anchors to that attribute; otherwise it falls back to the element start tag.

The initial public API does not expose raw parse nodes, parent pointers, descendant traversal, text content, or inner HTML. Those can be added later if real validators need them.

If a validator throws, the linter converts the failure to one error diagnostic anchored to the current element and names the validator id. A plugin bug should be visible without crashing the whole lint operation. Other validators, and other invocations of the same validator on other elements, continue to run.

## Rule Configuration

Validator ids are first-class rule ids. They can be configured in the existing `rules` object:

```jsonc
{
  "rules": {
    "pl/order-blocks-children": "warning",
    "pl/float-range": "off"
  }
}
```

Effective severity resolution:

1. `rules[validator.id]`, when present.
2. `validator.severity`, when present.
3. `error`.

Validators with effective severity `off` are not called.

Inline disable directives use the same rule id:

```mustache
{{! htmlmustache-disable pl/order-blocks-children }}
```

This matches the practical ESLint model: plugin-provided rules have stable ids, project config controls severities, and local suppressions target individual checks.

Config parsing accepts syntactically valid rule ids beyond the built-in rule names so plugin validator severities can be declared before `pluginModule` is loaded. This keeps config parsing pure and avoids a two-phase known-rule validation pass in the initial implementation. A `rules` entry whose validator is not loaded is ignored silently for now.

Disable directives also accept syntactically valid plugin rule ids. A typoed disable directive does not produce a warning in the initial implementation.

## Deprecations

`customTagDeprecations` remains schema-based, but only for the reduced flat attribute schema.

`deprecated: true` is an htmlmustache application annotation in this contract. It is not part of draft-06 validation, but htmlmustache scans it to produce deprecation diagnostics.

It can report:

- tag deprecations from root schema `deprecated: true`;
- attribute deprecations from `properties.<attribute>.deprecated: true`;
- attribute value deprecations expressible within the flat attribute schema.

It no longer reports child-tag combination deprecations because schemas no longer receive children.

## Diagnostics

Schema diagnostics keep HTML-oriented wording, but paths are simpler because the schema input is the attributes object directly. The common rewritten diagnostics remain:

- missing required attribute;
- unknown attribute;
- enum, const, type, minimum, maximum, pattern, and format failures on an attribute.

Validator diagnostics use the validator-supplied message and the element or attribute passed to `context.report`. The public diagnostic `ruleName` is the validator id.

Schema load failures continue to surface as `customTagSchema` diagnostics at the config diagnostic location when the rule is enabled. Plugin module load and export-shape failures surface as diagnostics under a new built-in `pluginModule` rule, defaulting to `error`.

The `pluginModule` rule controls diagnostics only. The loader still attempts to load the module when the rule is off, because formats and validators may be needed by other enabled checks.

The `formats` and `validators` exports are validated independently. A malformed `formats` export invalidates formats as a whole. A malformed individual validator descriptor is reported and skipped, while valid validators continue to load. Duplicate validator ids and collisions with built-in rule names are `pluginModule` error diagnostics; all descriptors with the conflicting id are skipped, and validators with other valid ids still load. If the module itself fails to import, neither export is available.

If `pluginModule` is configured, the module must provide at least one valid extension export: `formats` or `validators`. If no valid extension remains after export validation, emit one summary `pluginModule` diagnostic in addition to any specific export or descriptor diagnostics.

## Implementation Notes

The implementation should:

- replace `ajvModule` with `pluginModule` in config parsing and config loading;
- load `formats` and `validators` from `pluginModule`;
- accept programmatic `validators` in `createLinter`;
- export `TagValidator`, `TagElement`, and `ValidatorContext` types from `./linter`;
- add a built-in `pluginModule` rule for plugin module load and export-shape failures;
- switch schema compilation to draft-06;
- keep `ajv-errors` only if it works cleanly with the draft-06 AJV instance; do not retain draft 2020-12 only for custom error message plumbing;
- stop registering custom AJV keywords;
- remove `htmlGlobalAttributes` expansion;
- build schema input as a flat attribute object;
- remove schema construction of `tag`, `children`, `text`, and `innerHtml`;
- use one AST-based dynamic-attribute detector for schema mustache waiver and `TagElement.hasDynamicAttribute`;
- add a validator runner to the linter pipeline after built-in checks and schema validation;
- allow `rules` entries for plugin validator ids;
- include validator ids in rule severity resolution and allow permissive inline disable recognition;
- update `README.md`, `CONTEXT.md`, and tests for the new contract.

## Test Coverage

Add focused tests for:

- draft-06 flat attribute schema validation;
- custom formats loaded from `pluginModule`;
- custom AJV keywords not being registered;
- `pluginModule` load failures reported under the `pluginModule` rule;
- validator modules loaded from `pluginModule`;
- validators running only for matching tags;
- multiple validators on one tag;
- one validator targeting multiple tags;
- severity overrides through `rules`;
- inline disable by validator id;
- one-level child facades, including mustache-section flattening;
- validator reports anchored to an element or attribute;
- validator report severity coming only from rule-level severity resolution;
- validator exceptions becoming element-anchored error diagnostics;
- flat-schema deprecation behavior.
