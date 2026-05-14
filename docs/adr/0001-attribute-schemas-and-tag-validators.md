# Use Attribute Schemas and Tag Validators for Custom Tag Validation

Custom tag validation uses draft-06 JSON Schemas only for flat attribute objects, while child/content/domain checks move to synchronous tag validators loaded from a plugin module. This deliberately drops the richer schema envelope, schema-visible children/content, and custom AJV keywords because those features made JSON Schema carry rules that are clearer and easier to maintain as project-provided JavaScript validators with stable lint rule ids.

