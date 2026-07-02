import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { ModelSelector } from './ModelSelector';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';

const baseProps = {
  models: [{ instanceId: 'm1', modelName: 'Model A' }],
  activeModelId: 'm1',
  onSelectModel: vi.fn(),
  onAddModel: vi.fn(),
  onRemoveModel: vi.fn(),
  onExtractModels: vi.fn(),
};

describe('ModelSelector under a read-only run', () => {
  it('hides add-model, remove-model, and the AI-extract dropdown', () => {
    render(
      <RunEditabilityProvider stage="finalized">
        <ModelSelector {...baseProps} />
      </RunEditabilityProvider>,
    );
    expect(screen.queryByTitle('modelAddManuallyTitle')).not.toBeInTheDocument();
    expect(screen.queryByTitle('modelRemoveActiveTitle')).not.toBeInTheDocument();
    expect(screen.queryByTitle('modelExtractAITitle')).not.toBeInTheDocument();
  });

  it('positive control: editable render shows all three affordances', () => {
    render(<ModelSelector {...baseProps} />);
    expect(screen.getByTitle('modelAddManuallyTitle')).toBeInTheDocument();
    expect(screen.getByTitle('modelRemoveActiveTitle')).toBeInTheDocument();
    expect(screen.getByTitle('modelExtractAITitle')).toBeInTheDocument();
  });
});
