# Custom-Tag Attribute Validation via JSON Schema

**Status:** Design approved 2026-05-13
**Target version:** TBD (next minor after v0.9.x)
**Touches:** `src/core/`, `lsp/server/src/`, `cli/`, config schema, README

## 1. Motivation

Today the linter understands the *shape* of HTML/Mustache (tags, sections, attributes) and a vocabulary of generic lint rules plus user-defined `customRules` (CSS-like selectors). What it does **not** understand is the *contract* of each custom tag — what attributes it accepts, what values are legal, which combinations are allowed, and what children it expects.

PrairieLearn elements encode this contract today in Python `prepare()` functions. The exemplar is `pl-multiple-choice.py`:

- Required attribute: `answers-name`.
- Closed attribute set: ~20 optional attributes; anything else is an error.
- Value constraints: `score ∈ [0,1]`; `display ∈ {inline,block,dropdown}`.
- Cross-attribute mutexes: `inline` vs `display`; `fixed-order` vs `order`.
- Conditional require/forbid: `size`/`placeholder` require `display=dropdown`; `weight`/`hide-score-badge` forbidden when `builtin-grading=false`.
- Closed children set: only `<pl-answer>` (or comments) permitted.
- Required child count: ≥ 1 answer.
- Per-child attribute schema: `pl-answer` accepts `score`, `correct`, `feedback`.
- Cross parent→child rules: `pl-answer score`/`feedback` forbidden when parent `builtin-grading=false`.

These checks fire at *render* time, after sections have resolved, and only when an instance of the question is loaded. We want to lift them into the linter so authors get the same feedback at edit time, in CI, and for templates that never get rendered in the failing branch.

## 2. Goals & non-goals

**Goals**

- Declarative, file-based attribute/child validation for custom tags.
- Cover the full set of `prepare()` validations enumerated above.
- Standard schema language (JSON Schema draft 2020-12) so existing tooling, IDE hints, and generators work.
- Same diagnostic UX as existing rules: configurable severity, inline disable comments, fixable where possible.

**Non-goals (MVP)**

- Recursive child schemas (only one level of children is modeled).
- Section-correlated rules ("if `{{#x}}` is present then `{{#y}}` must be"). Section structure is flattened.
- Timeline-aware count semantics (`minItems` etc. evaluated per-timeline). Max-set semantics is used, consistent with selector rules.
- Auto-fixes for schema violations. Diagnostics-only in MVP.
- Replacing PrairieLearn's Python `prepare()` validation. This is a linter feature; PL may later choose to consume the same schemas.

## 3. Configuration surface

Extend `customTags[]` with an optional `schema` field. The value is either a path (resolved relative to `.htmlmustache.jsonc`) or an inline JSON Schema object.

```jsonc
{
  "customTags": [
    {
      "name": "pl-multiple-choice",
      "schema": "elements/pl-multiple-choice/pl-multiple-choice.schema.json"
    },
    {
      "name": "pl-answer",
      "schema": { /* inline draft-2020-12 schema */ }
    }
  ],
  "rules": {
    "customTagSchema": "error"   // default; "warning" / "off" supported
  }
}
```

- `schema: string` — path; resolved against the config file's directory; loaded lazily and cached per absolute path.
- `schema: object` — inline. Both file and inline schemas must declare `"$schema": "https://json-schema.org/draft/2020-12/schema"` (other drafts rejected with a config diagnostic).
- Schema-load failures (missing file, JSON parse error, ajv compile error) produce a single config-level diagnostic at row 0, column 0 of every file checked under that config. The tag's other behaviors (`display`, `languageAttribute`, etc.) are unaffected.
- Inline disable: `<!-- htmlmustache-disable customTagSchema -->` and `{{! htmlmustache-disable customTagSchema }}` follow the existing mechanism (registered in `customRuleIds` lookup).
- `customTagSchema` is registered in `ruleMetadata.ts` with default severity `error` and a one-line description for the rules table in the README.

## 4. Element-to-JSON mapping

For every `html_element` whose lowercase tag name has a registered schema, the checker constructs the JSON value the schema validates against.

```jsonc
// Source:
//   <pl-multiple-choice answers-name="q1" weight="2" inline>
//     <pl-answer correct="true" score="0.5">a</pl-answer>
//     {{#extra}}<pl-answer>b</pl-answer>{{/extra}}
//     <pl-bogus/>
//   </pl-multiple-choice>

// JSON passed to ajv:
{
  "tag": "pl-multiple-choice",
  "attributes": {
    "answers-name": "q1",
    "weight": "2",
    "inline": ""
  },
  "children": [
    { "tag": "pl-answer", "attributes": { "correct": "true", "score": "0.5" } },
    { "tag": "pl-answer", "attributes": {} },
    { "tag": "pl-bogus",  "attributes": {} }
  ]
}
```

Rules:

- **`tag`**: lowercase.
- **`attributes`**: object of `name → value`. Boolean-attribute syntax (no `=`) maps to `""`. Duplicate attributes (a separate lint rule) collapse last-wins to avoid double-reporting.
- **`children`**: one-level walk. Mustache sections (`{{#…}}` / `{{^…}}`) are *flattened* — their inner elements are included as if the section were absent. Mustache interpolations, comments, partials, raw text, and HTML whitespace are dropped. This matches the kind-transparent ("max-set") semantics already used by selector rules.
- **No `_fork` field**: section structure is not surfaced to the schema. Timeline-aware validation is out of scope; we lean on flatten + selector parity for now.

## 5. Attribute coercion and mustache waiver

ajv runs with `{ coerceTypes: true, allErrors: true, useDefaults: false, strict: false }`.

- `"2"` → `2` for `type: integer`; `"true"`/`"false"` → boolean; `""` → `true` for `type: boolean`. Mismatched coercion (e.g. `"abc"` for `integer`) emits a normal ajv error.
- **Mustache waiver.** Some attribute values are not literal because they contain mustache constructs (`weight="{{w}}"`, `display="{{prefix}}-block"`). At runtime they can take any value; the linter must not flag a value-rule violation.

  Implementation is a **single pass with sentinel substitution**, performed while building the JSON value:

  - Scan each attribute value for `{{`. If present, look up the schema branch that applies to that attribute (`properties[name]` after `allOf`/`anyOf` resolution) and substitute the *most permissive valid sentinel* derived from the schema:
    - `enum: [...]` → first enum value (always passes the enum check)
    - `type: boolean` → `true`
    - `type: integer` / `number` → `0` (or the schema's `minimum` if `minimum > 0`)
    - `type: string` → `""` (or any value matching `pattern`/`minLength`/`maxLength`; fall back to a single space if `minLength ≥ 1`)
    - No type / unconstrained → leave the original string (no value rules to fail)
  - Substitution is per-attribute. Presence is preserved (the key stays in `attributes`), so `required` and `additionalProperties: false` still fire on mustache-bearing attributes. Cross-attribute rules (`if/then` on attribute *values*) are intentionally waived when the gating attribute is mustache-bearing, since we can't statically know the runtime value.
  - The substitution lookup is best-effort: schemas with deeply nested `allOf`/`oneOf` branching may fall back to "no substitution" rather than risk a wrong choice. Documented limitation; authors are encouraged to use flat `properties` declarations for attributes that may be mustache-bearing.

- Schema authors write plain JSON Schema; no `nullable: true` or special markers are required.

## 6. Validation pipeline

New module: `src/core/customTagSchemaChecker.ts`.

```typescript
// Sketch
export interface SchemaRegistry {
  // Map lowercased tag name → compiled ajv validator + raw schema for messaging.
}

export function loadSchemaRegistry(
  customTags: CustomTagConfig[],
  configDir: string,
): { registry: SchemaRegistry; loadErrors: ConfigLoadError[] };

export function checkCustomTagSchemas(
  rootNode: BalanceNode,
  registry: SchemaRegistry,
): FixableError[];
```

Wiring:

1. **Config load.** `validateConfig` accepts `schema: string | object` on each `customTags[]` entry. File-system schema reads happen in `lsp/server/src/configFile.ts` (Node) and `cli/src/check.ts` (Node) — both already own config IO and can pass the resolved schemas into the core checker. The browser/web build runs with whatever inline schemas the embedding application provides; no FS reads in the browser bundle.
2. **Compile.** ajv compiles each schema once and stores it in the `SchemaRegistry` keyed by lowercased tag name. Failures (bad schema, unknown keyword, unsupported draft) produce a `ConfigLoadError` rendered as a row-0 diagnostic.
3. **Walk.** A single tree walk in the checker visits every `html_element`. For elements whose tag has a registered schema, it builds the JSON (per §4), applies the mustache waiver (per §5), runs ajv, and translates each `ErrorObject` into a `FixableError`.
4. **Slot into `collectErrors.ts`.** Add to the `ruleChecks` array, gated by the new `customTagSchema` rule key. Severity resolution and inline-disable parsing reuse the existing machinery (`KNOWN_RULE_NAMES`, `parseDisableDirective`, `customRuleIds`).
5. **CLI/LSP.** No new entry points. `collectErrors` already feeds both surfaces; the new diagnostics appear automatically.

## 7. Error mapping

Each ajv `ErrorObject` becomes a `FixableError` with:

- **`node`**: chosen by error kind, with the following priority for locating diagnostics —

  | ajv keyword                                | Node                                              |
  | ------------------------------------------ | ------------------------------------------------- |
  | `required` (attribute missing)             | element's `html_start_tag`                        |
  | `additionalProperties` on `attributes`     | the offending `html_attribute` node               |
  | `enum`/`pattern`/`type`/`minimum`/`maximum` on an attribute | offending `html_attribute_value` (or the attribute node if value is missing) |
  | `not`/`oneOf`/`anyOf`/`if-then` involving multiple attrs    | element's `html_start_tag`                        |
  | `additionalProperties`/`items` on children | the offending child element's start tag           |
  | `minItems`/`minContains`/`required` on children            | element's `html_start_tag`                        |

- **`message`**: prefer ajv's `errorMessage` (via `ajv-errors`) when the schema author supplies one; otherwise format ajv's default `keyword`/`params` into a human string (`"display must be one of 'inline', 'block', 'dropdown'"`).
- **`ruleName`**: always `'customTagSchema'`. Per-error rule names are out of MVP.
- **`severity`**: inherited from the `customTagSchema` rule severity.
- **`fix` / `fixDescription`**: absent in MVP.

## 8. Worked example

Schema for `pl-multiple-choice` (abridged; full file at `elements/pl-multiple-choice/pl-multiple-choice.schema.json`):

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["attributes"],
  "properties": {
    "tag": { "const": "pl-multiple-choice" },
    "attributes": {
      "type": "object",
      "required": ["answers-name"],
      "additionalProperties": false,
      "properties": {
        "answers-name":     { "type": "string", "minLength": 1 },
        "weight":           { "type": "integer", "minimum": 0 },
        "number-answers":   { "type": "integer", "minimum": 1 },
        "fixed-order":      { "type": "boolean" },
        "inline":           { "type": "boolean" },
        "display":          { "enum": ["inline", "block", "dropdown"] },
        "order":            { "enum": ["random", "ascend", "descend", "fixed"] },
        "size":             { "type": "integer", "minimum": 1 },
        "placeholder":      { "type": "string" },
        "builtin-grading":  { "type": "boolean" },
        "hide-score-badge": { "type": "boolean" },
        "all-of-the-above": {
          "anyOf": [
            { "type": "boolean" },
            { "enum": ["correct", "incorrect", "random"] }
          ]
        }
        /* ... */
      },
      "allOf": [
        { "not": { "required": ["inline", "display"] } },
        { "not": { "required": ["fixed-order", "order"] } },
        {
          "if":   { "required": ["size"] },
          "then": { "properties": { "display": { "const": "dropdown" } }, "required": ["display"] }
        },
        {
          "if":   { "properties": { "builtin-grading": { "const": false } }, "required": ["builtin-grading"] },
          "then": {
            "not": { "anyOf": [
              { "required": ["weight"] },
              { "required": ["hide-score-badge"] }
            ]}
          }
        }
      ]
    },
    "children": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "properties": {
          "tag":        { "const": "pl-answer" },
          "attributes": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "correct":  { "type": "boolean" },
              "feedback": { "type": "string" },
              "score":    { "type": "number", "minimum": 0, "maximum": 1 }
            }
          }
        },
        "required": ["tag"]
      }
    }
  },
  "allOf": [
    {
      "if":   { "properties": { "attributes": { "properties": { "builtin-grading": { "const": false } }, "required": ["builtin-grading"] } } },
      "then": { "properties": { "children": { "items": { "properties": { "attributes": {
        "not": { "anyOf": [
          { "required": ["score"] },
          { "required": ["feedback"] }
        ]}
      }}}}}}
    }
  ]
}
```

Cases the schema catches that `prepare()` currently catches:

| Template | Diagnostic |
|---|---|
| `<pl-multiple-choice>` (no `answers-name`) | required `answers-name` |
| `<pl-multiple-choice answers-name="q" foo="bar">` | unknown attribute `foo` |
| `<pl-multiple-choice answers-name="q" inline display="block">` | cannot use both `inline` and `display` |
| `<pl-multiple-choice answers-name="q" size="20">` | `size` requires `display="dropdown"` |
| `<pl-multiple-choice answers-name="q" builtin-grading="false" weight="2">` | `weight` forbidden when `builtin-grading=false` |
| `<pl-multiple-choice answers-name="q"><pl-bogus/></pl-multiple-choice>` | child `pl-bogus` not allowed; expected `pl-answer` |
| `<pl-multiple-choice answers-name="q"></pl-multiple-choice>` | requires ≥ 1 `pl-answer` |
| `<pl-multiple-choice answers-name="q"><pl-answer score="1.5"/></pl-multiple-choice>` | `score` must be ≤ 1 |
| `<pl-multiple-choice answers-name="q" builtin-grading="false"><pl-answer score="0.5"/></pl-multiple-choice>` | `score` forbidden when parent `builtin-grading=false` |
| `<pl-multiple-choice answers-name="q" weight="{{w}}">` | (waived — value contains mustache) |

## 9. Module/file layout

```
src/core/
  customTagSchemaChecker.ts      ← new: walk + build JSON + ajv invoke + error mapping
  customTagSchemaLoader.ts       ← new: compile schemas, resolve file/inline, cache
  ruleMetadata.ts                ← +1 entry: customTagSchema
  configSchema.ts                ← parseCustomTagArray accepts `schema: string | object`
  collectErrors.ts               ← +1 ruleChecks entry

lsp/server/src/
  configFile.ts                  ← resolve schema file paths relative to config dir

cli/src/
  check.ts                       ← pass resolved schemas through to collectErrors

package.json (root)
  + ajv ^8                       ← validator
  + ajv-errors ^3                ← optional human messages from schema

README.md
  + "Tag schemas" section
  + customTagSchema row in rules table
```

## 10. Test coverage plan

- **Unit (`src/core/customTagSchemaChecker.test.ts`):** for each cell of §8's table, the checker emits exactly the expected diagnostic with the expected node location and severity.
- **Mustache waiver:** values containing `{{var}}`, `{{#sec}}…{{/sec}}` inside attribute values, and partial-bearing values are waived; presence-rule failures still fire.
- **Section flattening:** an unknown child inside `{{#extra}}…{{/extra}}` is reported; a required child wrapped only in `{{#extra}}…{{/extra}}` is *not* reported (max-set is permissive for min counts — documented limitation, links to a follow-up issue for timeline-aware support).
- **Config:** missing schema file → row-0 diagnostic; invalid schema → row-0 diagnostic; inline schema with unsupported `$schema` → row-0 diagnostic.
- **Inline disable:** `<!-- htmlmustache-disable customTagSchema -->` suppresses all schema diagnostics in the file.
- **CLI integration (`cli/src/check.test.ts`):** running `htmlmustache check` against a fixture with `pl-multiple-choice` and the example schema produces the expected diagnostics with correct line/column.
- **LSP integration (`lsp/server/test/diagnostics.test.ts`):** the same fixture surfaces the same diagnostics through the language server.

## 11. Documentation

- New README section *"Tag schemas"* documenting:
  - The `schema` field on `customTags[]` (file path vs inline).
  - The JSON value shape (tag, attributes, children) so authors know what they're writing schemas against.
  - Coercion and mustache waiver semantics.
  - The section-flattening limitation and link to the timeline-aware follow-up issue.
- New row in the rules table for `customTagSchema`.

## 12. Out of scope, captured as follow-ups

1. **Timeline-aware count rules.** Reuse `htmlBalanceChecker`'s fork-extraction to enumerate per-element timelines so `minItems` etc. fire per timeline. Implementation requires a `2^N` cap and an aggregation step.
2. **Auto-fixes.** Schema-derived fixes (e.g. remove an unknown attribute, add a missing required one) — non-trivial to do safely.
3. **Per-error severity / per-error rule names.** Surface schema `errorMessage` and let authors map specific failures to `warning` vs `error`.
4. **Recursive child schemas.** Deeper trees (e.g. `pl-figure > pl-image > pl-caption`).
5. **Auto-discovery of schemas.** `customTags[].name` resolves to `<tagDir>/<tagName>.schema.json` by convention; explicit `schema` overrides.
6. **PrairieLearn consumes the schemas.** Generate Python validators from the same schema so `prepare()` can stop hand-rolling validation.
