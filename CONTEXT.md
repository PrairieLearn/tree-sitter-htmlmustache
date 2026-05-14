# Project glossary

Terms with project-specific meaning. Implementation-level vocabulary lives in code; only domain-meaningful terms go here.

## Tag schema

A JSON Schema (draft-06) bound to a custom tag via `customTags[].schema` in `.htmlmustache.jsonc`. Describes the tag's flat attribute object only: required attributes, value rules, combinations, and unknown-attribute policy. Validated by the linter; produces diagnostics under the `customTagSchema` rule.

Schemas can be either a path (resolved against the config file's directory) or an inline object. Browser embeddings accept inline only.

## Attribute shape

The JSON value that a tag schema validates against. Built from the attributes on each occurrence of the custom tag in the source. Shape:

```json
{
  "<attribute-name>": "<attribute-value>"
}
```

Valueless attributes are represented as `true`. The tag name is implicit from the `customTags[].name` entry that owns the schema.

## Tag validator

Project-provided JavaScript that runs for configured custom tag names and reports lint diagnostics for checks that cannot be expressed as an attribute schema.

## Plugin module

Executable project code loaded from `.htmlmustache.jsonc` that extends htmlmustache with schema formats and tag validators.

## Tag element

One parsed HTML element occurrence in a template, exposed to tag validators with its tag name, raw attributes, dynamic-attribute helper, direct child tag elements, and optional raw inner HTML.

## Dynamic attribute

An attribute whose parsed value contains a mustache construct and therefore may not have a statically knowable runtime value.

## Mustache waiver

The rule that attribute values containing `{{...}}` (or other mustache constructs) cannot be statically value-checked by a tag schema. Implementation:

1. The original raw attribute value is passed into the flat attribute object.
2. **Post-filter** after ajv runs: any value-dependent error whose `instancePath` traverses a dynamic attribute, or whose conditional branch depends on one, is suppressed.

Effect: presence and structural rules (`required`, `additionalProperties:false`) still fire on mustache-bearing attributes; value-dependent rules are waived.

## Max-set semantics

The linter's canonical treatment of mustache sections when reasoning about template structure: walk through `{{#…}}`/`{{^…}}` as if the section were always present. This applies to selector rules and to tag validator child traversal.

## Custom tag

A tag declared in `customTags[]` of `.htmlmustache.jsonc`. Custom tags may carry code-tag highlighting / formatting metadata (`languageAttribute`, `display`, etc.), a tag schema for attribute validation, or both.

## Schema diagnostic phrasing

The rule that `customTagSchema` diagnostics surface in HTML/element terms, not in JSON-Schema vocabulary. A template author should never see `instancePath`, `additionalProperty`, or `must match constant`; they see `Unknown attribute "extra" on <pl-multiple-choice>`, `<pl-card> is missing required attribute "kind"`, `Attribute "size" must be one of: "sm", "md"`. Implemented by `messageForError` in `js/linter/customTagSchemaChecker.ts`, which walks `error.instancePath` to recover attribute context and rewrites the common ajv keywords (`required`, `additionalProperties`, `enum`, `const`, `type`, `minimum`, `maximum`, `pattern`, `format`). Constraints without a rewriter fall through to ajv's localized text — by design: covering every keyword would balloon the rewriter without serving the common case.

## Deprecation annotation

The htmlmustache-specific use of `deprecated: true` inside a tag schema to produce `customTagDeprecations` diagnostics; draft-06 validation itself does not define this keyword.
