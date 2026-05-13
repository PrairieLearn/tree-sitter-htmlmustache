# Tag schemas use max-set semantics for mustache sections

When validating a custom-tag occurrence against its JSON Schema (see [tag-schema spec](../superpowers/specs/2026-05-13-attribute-validation-design.md)), mustache sections (`{{#x}}…{{/x}}` and `{{^x}}…{{/x}}`) are *flattened*: children inside a section are added to the parent's `children` list as if the section were always present. The schema validator never sees the section boundaries.

This makes the schema's behaviour consistent with the existing kind-transparent matching in `customRules` selectors and `htmlBalanceChecker`'s reachability tests: a schema diagnostic fires when a violation is reachable in *some* runtime timeline; a "missing required X" diagnostic fires only when X is reachable in *no* timeline (max-set is empty).

## Trade-off

The known cost: min-count rules can be silently bypassed by wrapping the only matches in a section.

```html
<pl-multiple-choice answers-name="q">
  {{#x}}<pl-answer correct="true"/>{{/x}}
</pl-multiple-choice>
```

Max-set is non-empty (one `pl-answer`), so `minItems: 1` passes. At runtime, when `x` is falsy, `prepare()` raises. The linter does not catch this.

## Considered alternatives

- **Full timeline enumeration.** Reuse `htmlBalanceChecker`'s `extractFromNode` + `mergeAdjacentForks` to produce 2^N timelines per element and run the schema on each, aggregating with "any-failure-wins" semantics. Correct, expensive, and the natural follow-up.
- **Cheap min-set heuristic.** Re-walk children counting only those *not* inside any section; run min-rules a second time against that set. Catches the common case but produces false positives on `{{#x}}…{{/x}}{{^x}}…{{/x}}` patterns (unconditionally present at runtime, min-set sees zero). False positives on a `default: error` rule erode trust faster than false negatives.

The MVP path is max-set + a captured follow-up for timeline enumeration. Min-set is rejected on false-positive grounds.
