import {useState} from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const getTemplateInstruction = vi.fn();
const updateTemplateInstruction = vi.fn();
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: (...a: unknown[]) => getTemplateInstruction(...a),
  updateTemplateInstruction: (...a: unknown[]) => updateTemplateInstruction(...a),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {TemplateInstructionPane} from '@/components/extraction/TemplateInstructionPane';

function Host() {
  const [draft, setDraft] = useState<string | null>(null);
  return <TemplateInstructionPane projectId="p1" templateId="t1" draft={draft} onDraftChange={setDraft} />;
}

function renderPane() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={queryClient}>
      <Host />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('TemplateInstructionPane', () => {
  it('edits and saves through the mutation', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Old text', default_instruction: null});
    updateTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'New text'});
    renderPane();
    const textarea = await screen.findByRole('textbox');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'New text');
    await userEvent.click(screen.getByRole('button', {name: 'instructionSave'}));
    await waitFor(() => expect(updateTemplateInstruction).toHaveBeenCalledWith('p1', 't1', 'New text'));
  });

  it('reset-to-default fills the textarea with the origin text', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Customized', default_instruction: 'Origin default'});
    renderPane();
    await userEvent.click(await screen.findByRole('button', {name: 'instructionResetDefault'}));
    expect(screen.getByRole('textbox')).toHaveValue('Origin default');
  });

  it('offers Cancel only while a draft differs, and Cancel discards it', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Old text', default_instruction: null});
    renderPane();
    const textarea = await screen.findByRole('textbox');
    expect(screen.queryByRole('button', {name: 'instructionCancel'})).toBeNull();
    await userEvent.type(textarea, ' plus mine');
    await userEvent.click(screen.getByRole('button', {name: 'instructionCancel'}));
    expect(screen.getByRole('textbox')).toHaveValue('Old text');
  });
});
