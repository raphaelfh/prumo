import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setMRV = vi.fn().mockResolvedValue({ extraction: true, quality_assessment: false });
vi.mock('@/services/hitlConfigService', () => ({
  setManagerReviewVisibility: (...args: unknown[]) => setMRV(...args),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { ManagerReviewVisibilityToggle } from '@/components/runs/ManagerReviewVisibilityToggle';

beforeEach(() => setMRV.mockClear());

describe('ManagerReviewVisibilityToggle', () => {
  it('PUTs the toggled value for its own kind', async () => {
    render(
      <ManagerReviewVisibilityToggle
        projectId="p1"
        kind="quality_assessment"
        currentValue={false}
      />,
    );
    const sw = screen.getByRole('switch');
    expect(sw).not.toBeChecked();
    await userEvent.click(sw);
    await waitFor(() =>
      expect(setMRV).toHaveBeenCalledWith('p1', 'quality_assessment', true),
    );
    expect(sw).toBeChecked();
  });

  it('reflects currentValue and respects disabled', () => {
    render(
      <ManagerReviewVisibilityToggle
        projectId="p1"
        kind="extraction"
        currentValue
        disabled
      />,
    );
    const sw = screen.getByRole('switch');
    expect(sw).toBeChecked();
    expect(sw).toBeDisabled();
  });
});
