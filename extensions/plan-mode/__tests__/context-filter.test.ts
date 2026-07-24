import { describe, expect, test } from 'bun:test';
import { filterStalePlanMessages } from '../context-filter.js';

describe('filterStalePlanMessages', () => {
  test('drops stale workflow custom messages', () => {
    const messages = [
      { customType: 'workflow-mode-context', content: 'old workflow instructions' },
      { customType: 'other-context', content: 'keep this message' },
    ];

    expect(filterStalePlanMessages(messages)).toEqual([messages[1]]);
  });

  test('drops stale workflow markers in string user content', () => {
    const messages = [
      { role: 'user', content: '[WORKFLOW MODE ACTIVE]\nold workflow instructions' },
      { role: 'user', content: 'keep this message' },
    ];

    expect(filterStalePlanMessages(messages)).toEqual([messages[1]]);
  });

  test('drops stale workflow markers in text blocks', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '[WORKFLOW MODE ACTIVE]\nold workflow instructions' }] },
      { role: 'user', content: [{ type: 'text', text: 'keep this message' }] },
    ];

    expect(filterStalePlanMessages(messages)).toEqual([messages[1]]);
  });
});
