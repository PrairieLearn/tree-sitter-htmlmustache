# Boolean Custom Tag Attributes Design

Date: 2026-05-15

## Context

`tree-sitter-htmlmustache` currently accepts HTML boolean attributes on custom tags. In the custom tag schema pipeline, an attribute written as `correct` in `<pl-answer correct>` is represented as the boolean literal `true`; an attribute with a value is represented as a string. The validator facade exposes the same shape through `TagElement.attributes`, `getAttribute()`, and `getLiteralAttribute()`, all typed as `string | true`.

Some projects want to reject boolean attributes for their custom elements because those elements expect explicit string-valued attributes. The option should be available globally for custom tag validation and locally for a single tag. Existing projects should keep the current permissive behavior unless they opt out.

## Goals

- Add a custom-tag-scoped option for rejecting boolean attributes.
- Preserve current behavior by default.
- Make config-level scope clear enough that it does not read as a whole-parser HTML option.
- Allow individual top-level and child tag entries to override the custom tag default.
- Report violations as ordinary custom tag schema diagnostics anchored to the offending attribute.
- Let TypeScript consumers narrow validator attribute values to strings when they intentionally opt into the no-boolean-attributes contract.

## Non-Goals

- Do not change the grammar or parser output.
- Do not reject boolean attributes on ordinary HTML tags.
- Do not add a new built-in lint rule name for this behavior.
- Do not infer no-boolean-attributes behavior from JSON Schema `type: "string"` alone.
- Do not force validator callbacks to become generic-heavy for existing users.

## Config Shape

Add `customTagDefaults` to `.htmlmustache.jsonc`:

```ts
interface HtmlMustacheConfig {
  customTagDefaults?: CustomTagDefaults;
  customTags?: CustomCodeTagConfig[];
}

interface CustomTagDefaults {
  allowBooleanAttributes?: boolean;
}
```

Add the same override field to both top-level custom tags and child tag entries:

```ts
interface CustomCodeTagConfig {
  name: string;
  allowBooleanAttributes?: boolean;
  children?: ChildTagConfig[];
}

interface ChildTagConfig {
  name: string;
  allowBooleanAttributes?: boolean;
  children?: ChildTagConfig[];
}
```

The default is `true`. This preserves the current representation where `<pl-answer correct>` exposes `correct: true`.

## Inheritance

Each schema-bearing or child-owned tag entry resolves `allowBooleanAttributes` with this precedence:

1. The tag or child entry's own `allowBooleanAttributes`, when present.
2. `customTagDefaults.allowBooleanAttributes`, when present.
3. `true`.

Child tag entries do not inherit the setting from their parent tag entry. They inherit from `customTagDefaults` unless the child entry has its own override. This keeps the option predictable: a parent controls its own attributes, and each child entry controls the child tag's attributes in that parent-owned context.

If the same child tag is declared under different parents, each child entry may use a different `allowBooleanAttributes` value, matching the existing parent-specific child schema behavior.

Example with boolean attributes disabled by default for custom tags, but allowed for `<pl-answer>`:

```jsonc
{
  "customTagDefaults": { "allowBooleanAttributes": false },
  "customTags": [{ "name": "pl-answer", "allowBooleanAttributes": true }],
}
```

## Validation Behavior

When the resolved setting for a custom tag entry is `false`, every literal HTML boolean attribute on that element is a `customTagSchema` diagnostic.

Example:

```html
<pl-answer correct></pl-answer>
```

with:

```jsonc
{
  "customTagDefaults": {
    "allowBooleanAttributes": false,
  },
  "customTags": [{ "name": "pl-answer" }],
}
```

reports:

```text
Attribute "correct" on <pl-answer> must have a value.
```

For a child schema context, the message includes the parent tag:

```text
Attribute "correct" on <pl-answer> inside <pl-multiple-choice> must have a value.
```

The diagnostic anchors to the boolean attribute node. The check runs before JSON Schema validation for the same element. The linter may still emit other schema diagnostics for other attributes on the same element, but it should avoid duplicate value-type diagnostics caused only by the `true` sentinel for the same boolean attribute when the no-boolean-attributes diagnostic already explains the issue.

Dynamic or mustache-shaped attributes are unaffected unless they parse as ordinary HTML boolean attributes. For example, `<pl-answer correct="{{value}}">` has a value and is not rejected by this option.

Ordinary HTML boolean attributes such as `<input disabled>` are not affected because the option applies only to configured custom tag entries.

## TypeScript API

Keep the existing default ergonomic API:

```ts
type AttributeValue = string | true;

interface TagElement<TAllowBooleanAttributes extends boolean = true> {
  readonly attributes: Readonly<
    Record<
      string,
      TAllowBooleanAttributes extends false ? string : AttributeValue
    >
  >;
  getAttribute(
    name: string,
  ): TAllowBooleanAttributes extends false
    ? string | undefined
    : AttributeValue | undefined;
  getLiteralAttribute(
    name: string,
  ): TAllowBooleanAttributes extends false
    ? string | undefined
    : AttributeValue | undefined;
}
```

Existing validators that use `TagElement` without a type argument keep seeing `string | true`. A project validator that intentionally targets tags with boolean attributes disabled can annotate its local helper or callback parameter as `TagElement<false>` to get string-only attribute values.

The runtime validator runner does not attempt to infer the generic type for arbitrary callbacks. The generic is an opt-in public type aid. The linter enforces the config at runtime.

## Implementation Notes

- Extend `HtmlMustacheConfig`, `CustomCodeTagConfig`, and `ChildTagConfig` in `js/shared/configSchema.ts` and `js/shared/customCodeTags.ts`.
- Extend the Zod config schema and regenerate `schemas/htmlmustache-config.schema.json`.
- Carry the resolved option through `loadSchemaRegistry()` into compiled top-level schemas, parent-owned child schemas, and child-only tag metadata.
- Teach `checkCustomTagSchemas()` to emit no-boolean-attributes diagnostics for configured custom tag contexts, including child-specific contexts.
- Reuse the existing attribute reader logic where possible so anchoring and dynamic detection stay consistent with flat schema validation.
- Update `TagElement` and related validator function types in `js/shared/tagValidators.ts` to support opt-in string-only narrowing.
- Keep `defineTagValidators()` source-compatible.
- Update README examples and the custom tag validation design context so users can find the new option.

## Testing

Add focused tests for:

- Default behavior still accepts `<pl-answer correct>`.
- `customTagDefaults.allowBooleanAttributes: false` rejects boolean attributes on top-level custom tags.
- A top-level tag override can opt back into boolean attributes.
- A top-level tag override can opt out while the default remains permissive.
- A child tag entry uses the global custom tag default when no child override is present.
- A child tag entry override can differ from the parent tag and from another parent's child entry for the same tag name.
- Diagnostics anchor to the offending boolean attribute.
- Valued literal attributes and dynamic valued attributes are not rejected by this option.
- Config parsing rejects misspelled or non-boolean `allowBooleanAttributes` fields.
- The generated config JSON Schema stays in sync.
- Type-level coverage proves `TagElement<false>` narrows `attributes` and helper return values to strings while plain `TagElement` remains `string | true`.
