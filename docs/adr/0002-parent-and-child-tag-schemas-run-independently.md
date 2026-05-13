# Parent and child tag schemas run independently

When a custom tag with a registered schema appears inside another custom tag whose schema also describes that child, **both schemas run**. Each custom tag occurrence is validated against its own schema (if registered) regardless of context, and the parent's schema independently validates the child via its `children` rules.

The author convention is that parent schemas describe direct children only insofar as a rule depends on parent state (e.g. "score forbidden when parent's `builtin-grading=false`"); everything else lives on the child. When this convention is followed, the two schemas are disjoint and produce non-overlapping diagnostics.

## Trade-off

Authors who duplicate rules across parent and child schemas get duplicate diagnostics on the same element. The linter does not deduplicate — the user deletes the redundant rule from one schema and the problem resolves.

## Considered alternatives

- **Parent overrides child.** When the parent schema describes children, the child's own schema is skipped. Rejected: makes schemas non-composable. A change to a parent silently disables the child's validation, which is a maintenance hazard. Also makes per-element validation context-dependent — the same `<pl-answer>` produces different diagnostics depending on its parent.
- **Only the element's own schema runs.** Parent schemas constrain only `tag.const` / closed-set membership; cross parent→child rules (like `builtin-grading=false ⇒ no score`) move to the child schema with a `$data` lookup. Rejected: `$data` is an ajv extension, doesn't cross HTML tree boundaries cleanly, and pushes context-aware logic onto every child schema even though only some parents need it.

Independent validation is the composition-friendly choice. The duplicate-diagnostic risk is the price of composability.
