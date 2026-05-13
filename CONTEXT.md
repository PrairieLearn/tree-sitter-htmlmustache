# Project glossary

Terms with project-specific meaning. Implementation-level vocabulary lives in code; only domain-meaningful terms go here.

## Tag schema

A JSON Schema (draft 2020-12) bound to a custom tag via `customTags[].schema` in `.htmlmustache.jsonc`. Describes the tag's attributes (required, value rules, combinations) and its direct children (allowed tags, counts, parent-context conditional rules). Validated by the linter; produces diagnostics under the `customTagSchema` rule.

Schemas can be either a path (resolved against the config file's directory) or an inline object. Browser embeddings accept inline only.

## Element shape

The JSON value that a tag schema validates against. Built from each occurrence of the custom tag in the source. Shape:

```json
{
  "tag": "<lowercased tag name>",
  "attributes": { "<name>": "<value>", ... },
  "children": [ { "tag": "...", "attributes": { ... } }, ... ]
}
```

One level of children only — child elements appear with `tag` + `attributes` but no further descent. Mustache interpolations, sections, partials, comments, raw text, and HTML whitespace/comments are dropped from `children`; the inner elements of `{{#…}}`/`{{^…}}` sections are *included* as if the section weren't there (kind-transparent / max-set semantics).

Both the parent tag's schema and each schema'd child's own schema validate independently — by convention authors keep them disjoint (parent describes children only insofar as a rule depends on parent state).

## Mustache waiver

The rule that attribute values containing `{{...}}` (or other mustache constructs) cannot be statically value-checked. Implementation:

1. **Sentinel substitution** while building the element shape: mustache-bearing values become a sentinel that satisfies the attribute's own value rules.
2. **Post-filter** after ajv runs: any error whose `instancePath` traverses a mustache-bearing attribute is suppressed.

Effect: presence and structural rules (required, additionalProperties:false, child counts) still fire on mustache-bearing attributes; value-dependent rules — including cross-attribute conditionals (`if/then` on a value) — are waived.

## Max-set semantics

The linter's canonical treatment of mustache sections when reasoning about template structure: walk through `{{#…}}`/`{{^…}}` as if the section were always present. A schema diagnostic fires when a violation appears in *some* possible runtime timeline; a "missing required X" diagnostic fires only when X appears in *no* timeline (the max-set). This is consistent with selector rules' kind-transparent matching. The trade-off: min-count rules can be silently bypassed by wrapping the only matches in a section — accepted as a known limitation, with full timeline enumeration deferred as a follow-up.

## Custom tag

A tag declared in `customTags[]` of `.htmlmustache.jsonc`. Until this work, custom tags only carried code-tag highlighting / formatting metadata (`languageAttribute`, `display`, etc.). The `schema` field adds attribute/child validation. The same `customTags` entry may set both, may set neither, or may set just one — `schema` is independent of the code-tag fields.
