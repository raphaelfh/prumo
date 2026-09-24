import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {buildClientSnippet} from '@/lib/mcp/clientSnippets';
import {t} from '@/lib/copy';
import {McpClientSnippetSelector} from '@/components/user/McpClientSnippetSelector';

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.test');
  Object.assign(navigator, {clipboard: {writeText}});
  writeText.mockClear();
});
afterEach(() => vi.stubEnv('VITE_API_URL', ''));

const TOKEN = 'prumo_pat_SECRET';
const URL = 'https://api.test/mcp';

describe('McpClientSnippetSelector', () => {
  it('shows all six chips, with claude-code selected by default', () => {
    render(<McpClientSnippetSelector token={TOKEN} />);
    for (const key of ['chipClaudeCode', 'chipCursor', 'chipVsCode', 'chipGeminiCli', 'chipCodex', 'chipWindsurf'] as const) {
      expect(screen.getByRole('radio', {name: t('personalAccessTokens', key)})).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', {name: t('personalAccessTokens', 'chipClaudeCode')})).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(t('personalAccessTokens', 'instructionClaudeCode'))).toBeInTheDocument();
    expect(screen.getByText(buildClientSnippet('claude-code', {url: URL, token: TOKEN})).tagName).toBe('PRE');
  });

  it('switching the chip swaps the instruction and the snippet', async () => {
    render(<McpClientSnippetSelector token={TOKEN} />);
    await userEvent.click(screen.getByRole('radio', {name: t('personalAccessTokens', 'chipCursor')}));

    expect(screen.getByText(t('personalAccessTokens', 'instructionCursor'))).toBeInTheDocument();
    const pre = screen.getByText((_, el) => el?.tagName === 'PRE');
    expect(JSON.parse(pre.textContent ?? '')).toEqual(JSON.parse(buildClientSnippet('cursor', {url: URL, token: TOKEN})));
  });

  it('the Copy button copies exactly the visible client snippet', async () => {
    render(<McpClientSnippetSelector token={TOKEN} />);
    await userEvent.click(screen.getByRole('radio', {name: t('personalAccessTokens', 'chipCursor')}));
    await userEvent.click(screen.getByRole('button', {name: t('personalAccessTokens', 'copy')}));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(buildClientSnippet('cursor', {url: URL, token: TOKEN})));
  });
});
