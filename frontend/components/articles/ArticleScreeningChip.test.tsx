import {beforeEach, describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';

import {ArticleScreeningChip} from '@/components/articles/ArticleScreeningChip';
import type {ArticleStage} from '@/lib/screening/articleStage';

const stageOf = vi.fn<(articleId: string) => ArticleStage | null>();
vi.mock('@/hooks/screening/useArticleScreeningStages', () => ({
  useArticleScreeningStages: () => ({stageOf}),
}));

const TONE = 'bg-muted text-foreground';

describe('ArticleScreeningChip', () => {
  beforeEach(() => stageOf.mockReset());

  it('renders "Title/abstract · Reviewers disagree"', () => {
    stageOf.mockReturnValue({label: 'statusConflict', prefix: 'tabTitleAbstract', tone: TONE});
    render(<ArticleScreeningChip projectId="p1" articleId="a1" />);
    expect(screen.getByText('Title/abstract · Reviewers disagree')).toBeInTheDocument();
    expect(stageOf).toHaveBeenCalledWith('a1');
  });

  it('renders "Full text · Not retrieved"', () => {
    stageOf.mockReturnValue({label: 'statusNotRetrieved', prefix: 'tabFullText', tone: TONE});
    render(<ArticleScreeningChip projectId="p1" articleId="a1" />);
    expect(screen.getByText('Full text · Not retrieved')).toBeInTheDocument();
  });

  it.each([
    ['statusIncluded', 'Included'],
    ['statusExcluded', 'Excluded'],
    ['statusNotEnrolled', 'Not enrolled'],
    ['stageDuplicate', 'Duplicate'],
  ] as const)('renders %s without a prefix', (label, text) => {
    stageOf.mockReturnValue({label, prefix: null, tone: TONE});
    render(<ArticleScreeningChip projectId="p1" articleId="a1" />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('renders nothing when stageOf returns null', () => {
    stageOf.mockReturnValue(null);
    const {container} = render(<ArticleScreeningChip projectId="p1" articleId="a1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
