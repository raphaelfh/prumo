import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import type {RunProvenance} from '@/types/ai-extraction';
import {GenerationDetailsDialog} from './GenerationDetailsDialog';

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

describe('GenerationDetailsDialog', () => {
  it('renders params grid, composition recipe, split-calls note and truncated badge', () => {
    render(<GenerationDetailsDialog provenance={structured} open onOpenChange={() => {}} />);
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
});
