import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {RunProvenance} from '@/types/ai-extraction';

vi.mock('@/hooks/extraction/useArticleContentMarkdown', () => ({
  useArticleContentMarkdown: vi.fn(),
}));

import {useArticleContentMarkdown} from '@/hooks/extraction/useArticleContentMarkdown';
import {GenerationDetailsDialog} from './GenerationDetailsDialog';
import {RunEditabilityProvider} from '@/components/runs/RunEditabilityContext';

const mdHook = useArticleContentMarkdown as unknown as ReturnType<typeof vi.fn>;

const structured: RunProvenance = {
  model: 'gpt-4o-mini',
  provider: 'openai',
  temperature: 0.1,
  tokensPrompt: 23710,
  tokensCompletion: 970,
  tokensTotal: 24680,
  ranByName: 'raphael',
  promptVersion: '0b5b7ef9ab73',
  promptComposition: {
    sectionName: 'Source of Data',
    systemPrompt: 'You are an expert at extracting structured data.',
    sectionInstruction: 'Extract the following…\nArticle text:\n[[ARTICLE_MARKDOWN]]',
    articleRef: {fileName: 'teste3.pdf', truncated: true, estTokens: 23000},
    fieldsRequested: ['data_source', 'recruitment'],
    llmCalls: 2,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the expand hook is idle (not fetched until opened).
  mdHook.mockReturnValue({data: undefined, isLoading: false, isError: false, refetch: vi.fn()});
});

describe('GenerationDetailsDialog', () => {
  it('renders params grid, composition recipe, split-calls note and truncated badge', () => {
    render(
      // Identity-bearing surfaces ("Ran by", the name in the context pill)
      // need the peer-identity grant (D3, fail-closed) — see the dedicated
      // case below for the provider-less behavior.
      <RunEditabilityProvider stage="extract" showPeerIdentity>
        <GenerationDetailsDialog provenance={structured} open onOpenChange={() => {}} />
      </RunEditabilityProvider>,
    );
    // Title + context
    expect(screen.getByText('How this was generated')).toBeInTheDocument();
    expect(screen.getByText(/Source of Data · raphael/)).toBeInTheDocument();
    // Params
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    // Recipe
    expect(screen.getByText('System prompt')).toBeInTheDocument();
    expect(screen.getByText('Section instruction')).toBeInTheDocument();
    expect(screen.getByText(/\[\[ARTICLE_MARKDOWN\]\]/)).toBeInTheDocument();
    expect(screen.getByText('teste3.pdf')).toBeInTheDocument();
    // truncated notice + split-calls note
    expect(screen.getByText(/budgeted subset/i)).toBeInTheDocument();
    expect(screen.getByText(/Split across 2 calls/)).toBeInTheDocument();
    // requested fields as chips
    expect(screen.getByText('data_source')).toBeInTheDocument();
    expect(screen.getByText('recruitment')).toBeInTheDocument();
    // token totals
    expect(screen.getByText('24,680')).toBeInTheDocument();
  });

  it('never renders the raw system prompt as a generic params row (only in the recipe)', () => {
    render(<GenerationDetailsDialog provenance={structured} open onOpenChange={() => {}} />);
    // promptText is absent here; ensure no generic "promptText" key leaks
    expect(screen.queryByText('promptText')).not.toBeInTheDocument();
  });

  it('falls back to flat rows + a legacy prompt code block when there is no composition', () => {
    const legacy: RunProvenance = {
      model: 'gpt-4o',
      promptText: 'LEGACY SYSTEM PROMPT TEXT',
      tokensTotal: 100,
    };
    render(<GenerationDetailsDialog provenance={legacy} open onOpenChange={() => {}} />);
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    // legacy prompt renders in a code block, not as a generic row
    expect(screen.getByText(/LEGACY SYSTEM PROMPT TEXT/)).toBeInTheDocument();
    expect(screen.queryByText('Prompt composition')).not.toBeInTheDocument();
    expect(screen.queryByText('System prompt')).not.toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<GenerationDetailsDialog provenance={structured} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText('How this was generated')).not.toBeInTheDocument();
  });

  it('shows a "view text sent" expand only when an articleId is provided', () => {
    const {rerender} = render(
      <GenerationDetailsDialog provenance={structured} open onOpenChange={() => {}} />,
    );
    expect(screen.queryByText('View text sent')).not.toBeInTheDocument();
    rerender(
      <GenerationDetailsDialog
        provenance={structured}
        articleId="art-1"
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('View text sent')).toBeInTheDocument();
  });

  it('expands the stored markdown on click', () => {
    mdHook.mockReturnValue({
      data: {fileName: 'teste3.pdf', contentMarkdown: '# STORED MARKDOWN BODY'},
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(
      <GenerationDetailsDialog
        provenance={structured}
        articleId="art-1"
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('View text sent'));
    expect(screen.getByText(/STORED MARKDOWN BODY/)).toBeInTheDocument();
  });

  it('renders an inline retry when the markdown fetch errors', () => {
    const refetch = vi.fn();
    mdHook.mockReturnValue({data: undefined, isLoading: false, isError: true, refetch});
    render(
      <GenerationDetailsDialog
        provenance={structured}
        articleId="art-1"
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('View text sent'));
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the section-snapshot mode/passes keys as generic rows (§IX execution record)', () => {
    // These survive today only because the mapper rest-spreads unknown keys
    // and this dialog renders leftovers generically — a future cleanup of
    // either layer must not silently drop the Verified-mode execution truth.
    const withModes: RunProvenance = {
      model: 'gpt-4o-mini',
      mode_requested: 'verified',
      mode_executed: 'fast',
      passes: 1,
    };
    render(<GenerationDetailsDialog provenance={withModes} open onOpenChange={() => {}} />);
    expect(screen.getByText('mode_requested')).toBeInTheDocument();
    expect(screen.getByText('verified')).toBeInTheDocument();
    expect(screen.getByText('mode_executed')).toBeInTheDocument();
    expect(screen.getByText('fast')).toBeInTheDocument();
    expect(screen.getByText('passes')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('hides the Ran-by surfaces without the peer-identity grant (fail-closed)', () => {
    // Provider-less render = no grant: the runner's name must not appear in
    // the context pill nor as a "Ran by" params row (D3 display consistency).
    render(<GenerationDetailsDialog provenance={structured} open onOpenChange={() => {}} />);
    expect(screen.queryByText(/raphael/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ran by')).not.toBeInTheDocument();
    // Everything non-identity still renders.
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
  });
});
