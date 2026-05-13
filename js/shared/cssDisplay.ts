/**
 * CSS `display` values relevant to the formatter and to configuration.
 *
 * Lives in `shared/` rather than `formatter/` because `configSchema` and
 * `customCodeTags` (both shared) need this type to describe how custom code
 * tags should be indented. The formatter's classifier owns the *lookup
 * tables* that map elements to these values.
 */
export type CSSDisplay =
  | 'block'
  | 'inline'
  | 'inline-block'
  | 'table-row'
  | 'table-cell'
  | 'table'
  | 'table-row-group'
  | 'table-header-group'
  | 'table-footer-group'
  | 'table-column'
  | 'table-column-group'
  | 'table-caption'
  | 'list-item'
  | 'ruby'
  | 'ruby-base'
  | 'ruby-text'
  | 'none';
