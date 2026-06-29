import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {AISuggestionHistoryPopover} from './AISuggestionHistoryPopover';
import type {AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';

const longValue =
  'Randomized controlled trial with a very long extracted value that clearly exceeds fifty characters of text';

const items: AISuggestionHistoryItem[] = [
  {
    id: 'cur', runId: 'r2', value: longValue, confidence: 0.9, reasoning: 'r',
    status: 'pending', timestamp: new Date('2026-06-27T10:00:00'), evidence: [],
  },
  {
    id: 'old', runId: 'r1', value: 'Cohort', confidence: 0.4, reasoning: 'r',
    status: 'rejected', timestamp: new Date('2026-06-20T09:00:00'), evidence: [],
  },
];

async function open() {
  const user = userEvent.setup();
  render(
    <AISuggestionHistoryPopover
      instanceId="i"
      fieldId="f"
      currentSuggestionId="cur"
      getHistory={async () => items}
      trigger={<button>open</button>}
    />,
  );
  await user.click(screen.getByText('open'));
}

describe('AISuggestionHistoryPopover', () => {
  it('shows the full (untruncated) value', async () => {
    await open();
    await waitFor(() => expect(screen.getByText(longValue)).toBeInTheDocument());
  });

  it('marks the run holding the current suggestion with the Current key', async () => {
    await open();
    await waitFor(() => expect(screen.getByText('historyCurrentRun')).toBeInTheDocument());
  });

  it('does not label runs by positional index', async () => {
    await open();
    await waitFor(() => expect(screen.getByText(longValue)).toBeInTheDocument());
    expect(screen.queryByText(/#\s*\d/)).toBeNull();
  });

  it('does not emit console.warn debug logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    await waitFor(() => expect(screen.getByText(longValue)).toBeInTheDocument());
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
