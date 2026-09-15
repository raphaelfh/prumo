/**
 * The QA Active tool control (spec 2026-09-15 §12): static for one tool, a
 * menu for several, and a folding label that never leaves the accessible name.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HITLActiveTemplateBar } from '@/components/hitl/HITLActiveTemplateBar';
import type { ProjectTemplate } from '@/hooks/hitl/useHITLProjectTemplates';
import { t } from '@/lib/copy';

const tool = (id: string, name: string, version = '1.0.0') =>
  ({ id, name, version, kind: 'quality_assessment', is_active: true }) as ProjectTemplate;

const PROBAST = tool('tpl-probast', 'PROBAST+AI', '2.0.0');
const QUADAS = tool('tpl-quadas', 'QUADAS-2');
const BAR = 'hitl-quality_assessment-active-template-bar';
const NAME = 'hitl-quality_assessment-active-template-name';
const TRIGGER = 'hitl-quality_assessment-active-template-trigger';

describe('HITLActiveTemplateBar', () => {
  it('shows a single tool as static text reading "Active tool: <name>"', () => {
    render(<HITLActiveTemplateBar templates={[PROBAST]} activeTemplate={PROBAST} onSelect={vi.fn()} />);

    expect(screen.getByTestId(BAR)).toHaveTextContent(`${t('qa', 'activeTemplateLabel')} PROBAST+AI`);
    expect(screen.getByTestId(NAME)).toHaveTextContent('PROBAST+AI');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('folds the label to sr-only on a narrow toolbar and keeps it in the trigger name', () => {
    render(<HITLActiveTemplateBar templates={[PROBAST, QUADAS]} activeTemplate={PROBAST} onSelect={vi.fn()} />);

    const label = screen.getByText(t('qa', 'activeTemplateLabel'));
    expect(label).toHaveClass('sr-only', '@[48rem]/listbar:not-sr-only');
    expect(label).not.toHaveClass('hidden');
    expect(screen.getByRole('button', { name: /Active tool:\s*PROBAST\+AI/ })).toBeInTheDocument();
  });

  it('switches tools from the menu', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<HITLActiveTemplateBar templates={[PROBAST, QUADAS]} activeTemplate={PROBAST} onSelect={onSelect} />);

    await user.click(screen.getByTestId(TRIGGER));
    await user.click(await screen.findByTestId('hitl-quality_assessment-active-template-option-tpl-quadas'));

    expect(onSelect).toHaveBeenCalledWith('tpl-quadas');
  });

  it('truncates a long name and carries the full name in a tooltip', async () => {
    const user = userEvent.setup();
    const long = tool('tpl-long', 'A very long quality assessment tool name for prediction models');
    render(<HITLActiveTemplateBar templates={[long, QUADAS]} activeTemplate={long} onSelect={vi.fn()} />);

    expect(screen.getByTestId(NAME)).toHaveClass('truncate', 'min-w-0');
    await user.hover(screen.getByTestId(TRIGGER));
    // The visible (truncated) name plus the tooltip copy — wait past the
    // tooltip's open delay for the second match to mount.
    await waitFor(() => {
      expect(screen.getAllByText(long.name).length).toBeGreaterThan(1);
    });
  });

  it('shows the dashed hint when no tool is enabled', () => {
    render(<HITLActiveTemplateBar templates={[]} activeTemplate={null} onSelect={vi.fn()} />);

    expect(screen.getByTestId('hitl-quality_assessment-active-template-bar-empty'))
      .toHaveTextContent(t('qa', 'activeTemplateNone'));
  });
});
