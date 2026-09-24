import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {t} from '@/lib/copy';
import {CopyBlock} from '@/components/user/CopyBlock';

describe('CopyBlock', () => {
  it('renders the label and the code in a <pre>', () => {
    render(<CopyBlock label="Claude Code" code="claude mcp add prumo" />);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('claude mcp add prumo').tagName).toBe('PRE');
  });

  it('copies the code to the clipboard and shows "copied" until the reset', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {clipboard: {writeText}});
    render(<CopyBlock label="Claude Code" code="claude mcp add prumo" />);

    await userEvent.click(screen.getByRole('button', {name: t('personalAccessTokens', 'copy')}));

    expect(writeText).toHaveBeenCalledWith('claude mcp add prumo');
    await waitFor(() => expect(screen.getByRole('button', {name: t('personalAccessTokens', 'copy')})).toHaveTextContent(t('personalAccessTokens', 'copied')));
  });

  it('takes a custom copyAriaLabel', () => {
    render(<CopyBlock label="Secret" code="prumo_pat_SECRET" copyAriaLabel={t('personalAccessTokens', 'copyTokenAria')} />);
    expect(screen.getByRole('button', {name: t('personalAccessTokens', 'copyTokenAria')})).toBeInTheDocument();
  });
});
