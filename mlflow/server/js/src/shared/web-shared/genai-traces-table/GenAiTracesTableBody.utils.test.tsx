import { describe, it, expect } from '@jest/globals';

import { formatResponseTitle } from './GenAiTracesTableBody.utils';

describe('formatResponseTitle', () => {
  it('extracts content from OpenAI response nested under `response`', () => {
    const payload = JSON.stringify({
      response: {
        choices: [{ message: { role: 'assistant', content: 'nested openai content' } }],
      },
    });
    expect(formatResponseTitle(payload)).toBe('nested openai content');
  });

  it('extracts content from raw OpenAI choices shape', () => {
    const payload = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'raw openai content' } }],
    });
    expect(formatResponseTitle(payload)).toBe('raw openai content');
  });

  it('extracts content from LangChain AIMessage shape', () => {
    const payload = JSON.stringify({ content: 'Hi' });
    expect(formatResponseTitle(payload)).toBe('Hi');
  });

  it('extracts content of last message from ChatAgent messages shape', () => {
    const payload = JSON.stringify({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'last' },
      ],
    });
    expect(formatResponseTitle(payload)).toBe('last');
  });

  it('prefers the last assistant turn over a trailing tool/user turn', () => {
    const payload = JSON.stringify({
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'the answer' },
        { role: 'tool', content: 'tool result' },
        { role: 'user', content: 'follow-up' },
      ],
    });
    expect(formatResponseTitle(payload)).toBe('the answer');
  });

  it('falls back to the last string-content message when no assistant turn exists', () => {
    const payload = JSON.stringify({
      messages: [{ role: 'user', content: 'only turn' }],
    });
    expect(formatResponseTitle(payload)).toBe('only turn');
  });

  it('unwraps a plain `{response: "..."}` string wrapper', () => {
    const payload = JSON.stringify({ response: 'just the answer' });
    expect(formatResponseTitle(payload)).toBe('just the answer');
  });

  it('unwraps a JSON-encoded plain string', () => {
    const payload = JSON.stringify('hello');
    expect(formatResponseTitle(payload)).toBe('hello');
  });

  it('passes through a plain non-JSON string unchanged', () => {
    expect(formatResponseTitle('hello world')).toBe('hello world');
  });

  it('falls back gracefully for a non-matching object shape', () => {
    const payload = JSON.stringify({ foo: 'bar', nested: { baz: 1 } });
    // Should not throw; must return some string representation.
    expect(() => formatResponseTitle(payload)).not.toThrow();
    expect(typeof formatResponseTitle(payload)).toBe('string');
  });

  it('returns an empty string for an empty input', () => {
    expect(formatResponseTitle('')).toBe('');
  });
});
