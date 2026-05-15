import { describe, expect, it } from 'vitest';

import { defaultOptions, format, formatRange } from './helpers.js';

describe('Document Formatting Integration', () => {
  it('runs the full parser to formatter pipeline for mixed HTML and Mustache', () => {
    expect(format('<ul>{{#items}}<li>{{name}}</li>{{/items}}</ul>')).toBe(
      '<ul>\n  {{#items}}\n    <li>{{name}}</li>\n  {{/items}}\n</ul>\n',
    );
  });

  it('keeps adjacent inline HTML and Mustache in text flow', () => {
    expect(
      format(
        '<span class="badge">\n  <i class="far fa-circle" aria-hidden="true"></i>\n  {{partial}}%\n</span>',
      ),
    ).toBe(
      '<span class="badge">\n  <i class="far fa-circle" aria-hidden="true"></i> {{partial}}%\n</span>\n',
    );
  });

  it('formats ranges without exercising the full document test matrix again', () => {
    const output = formatRange(
      '<div>\n<p>hello</p>\n</div>',
      {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 12 },
      },
      defaultOptions,
    );

    expect(output).toBe('<p>hello</p>');
  });
});
