/**
 * BatchRowStatus + useBatchRowStatus (spec 2026-09-15 §11.1/§11.4 row indicators).
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {renderHook} from '@testing-library/react';

import {BatchRowStatus} from '@/components/extraction/batch/BatchRowStatus';

vi.mock('@/hooks/extraction/useExtractionBatches', () => ({
  useActiveBatches: vi.fn(),
  useBatchDetail: vi.fn(),
}));

import {
  useActiveBatches,
  useBatchDetail,
} from '@/hooks/extraction/useExtractionBatches';
import {useBatchRowStatus} from '@/components/extraction/batch/useBatchRowStatus';

const mockActiveBatches = useActiveBatches as unknown as ReturnType<typeof vi.fn>;
const mockBatchDetail = useBatchDetail as unknown as ReturnType<typeof vi.fn>;

describe('BatchRowStatus', () => {
  it('renders nothing for undefined', () => {
    const {container} = render(<BatchRowStatus status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the queued indicator with accessible name', () => {
    render(<BatchRowStatus status="queued" />);
    expect(screen.getByLabelText('Queued for AI')).toBeInTheDocument();
  });

  it('renders the running indicator with accessible name', () => {
    render(<BatchRowStatus status="running" />);
    expect(screen.getByLabelText('AI is running')).toBeInTheDocument();
  });
});

describe('useBatchRowStatus', () => {
  it('picks the active batch for THIS template, ignoring another template\'s batch', () => {
    mockActiveBatches.mockReturnValue({
      data: [
        {id: 'other', template_id: 't-other', state: 'active'},
        {id: 'mine', template_id: 't1', state: 'active'},
      ],
    });
    mockBatchDetail.mockReturnValue({
      data: {
        items: [
          {article_id: 'a1', outcome: 'queued'},
          {article_id: 'a2', outcome: 'running'},
          {article_id: 'a3', outcome: 'done'},
        ],
      },
    });

    const {result} = renderHook(() => useBatchRowStatus('p1', 't1'));

    expect(result.current.activeBatch).toMatchObject({id: 'mine', template_id: 't1'});
    expect(mockBatchDetail).toHaveBeenCalledWith('mine');
    expect(result.current.rowStatus.get('a1')).toBe('queued');
    expect(result.current.rowStatus.get('a2')).toBe('running');
    expect(result.current.rowStatus.has('a3')).toBe(false);
    expect(result.current.rowStatus.size).toBe(2);
  });

  it('passes null to useBatchDetail when there is no active batch for this template', () => {
    mockActiveBatches.mockReturnValue({data: []});
    mockBatchDetail.mockReturnValue({data: undefined});

    const {result} = renderHook(() => useBatchRowStatus('p1', 't1'));

    expect(result.current.activeBatch).toBeNull();
    expect(mockBatchDetail).toHaveBeenCalledWith(null);
    expect(result.current.rowStatus.size).toBe(0);
  });
});
