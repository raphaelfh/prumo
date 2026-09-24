import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {t} from '@/lib/copy';
import {TOKEN_PLACEHOLDER} from '@/lib/mcp/clientSnippets';
import {McpClientConfigCard} from '@/components/user/McpClientConfigCard';

describe('McpClientConfigCard', () => {
  it('always renders the title, hint, docs link and a placeholder snippet', () => {
    render(<McpClientConfigCard />);

    expect(screen.getByRole('heading', {level: 2, name: t('personalAccessTokens', 'connectTitle')})).toBeInTheDocument();
    expect(screen.getByText(t('personalAccessTokens', 'connectHint'))).toBeInTheDocument();

    const link = screen.getByRole('link', {name: new RegExp(t('personalAccessTokens', 'docsLink'))});
    expect(link).toHaveAttribute('href', 'https://github.com/raphaelfh/prumo/blob/dev/docs/how-to/connect-an-ai-agent.md');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    expect(screen.getByText((content) => content.includes(TOKEN_PLACEHOLDER))).toBeInTheDocument();
    expect(screen.queryByText(/prumo_pat_/)).not.toBeInTheDocument();
  });
});
