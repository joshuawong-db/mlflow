import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { DesignSystemProvider } from '@databricks/design-system';
import { IntlProvider } from '@databricks/i18n';

import { ResponseCellContent } from './rendererFunctions';
import { formatResponseTitle } from '../GenAiTracesTableBody.utils';

const renderResponseCell = (rawResponse: string, searchQuery?: string) => {
  const formatted = formatResponseTitle(rawResponse);
  return render(
    <IntlProvider locale="en">
      <DesignSystemProvider>
        <ResponseCellContent value={formatted} searchQuery={searchQuery} />
      </DesignSystemProvider>
    </IntlProvider>,
  );
};

describe('Response cell rendering', () => {
  it('unwraps LangChain {content} payload and shows the inner text without JSON braces', () => {
    renderResponseCell(JSON.stringify({ content: 'Hello world' }));

    expect(screen.getByText('Hello world', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/[{}]/)).not.toBeInTheDocument();
  });

  it('unwraps ChatAgent messages payload to the last assistant turn', () => {
    renderResponseCell(
      JSON.stringify({
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'use this answer' },
        ],
      }),
    );

    expect(screen.getByText('use this answer', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/[{}]/)).not.toBeInTheDocument();
  });

  it('unwraps OpenAI raw choices payload', () => {
    renderResponseCell(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'plain answer' } }],
      }),
    );

    expect(screen.getByText('plain answer', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/[{}]/)).not.toBeInTheDocument();
  });

  it('falls back to plain string passthrough for non-JSON input', () => {
    renderResponseCell('just a string');
    expect(screen.getByText('just a string', { exact: false })).toBeInTheDocument();
  });

  it('highlights search-query matches inline', () => {
    renderResponseCell(JSON.stringify({ content: 'Hello world' }), 'world');
    const mark = document.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('world');
  });

  it('renders markdown syntax literally rather than executing it', () => {
    // Plain-text rendering means a malicious link or image markdown stays inert.
    renderResponseCell(JSON.stringify({ content: '[click](https://attacker.example)' }));
    expect(screen.getByText('[click](https://attacker.example)', { exact: false })).toBeInTheDocument();
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders the empty/null placeholder for empty input', () => {
    renderResponseCell('');
    expect(screen.getByText('null')).toBeInTheDocument();
  });
});
