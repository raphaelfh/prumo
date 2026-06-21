import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SaveSlot } from '@/components/runs/header/SaveSlot';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SaveSlot (transient)', () => {
  it('shows Saving… while saving', () => {
    render(<SaveSlot state="saving" lastSavedAt={null} />);
    expect(screen.getByText('saving')).toBeInTheDocument();
  });
  it('shows Saved then fades it out', () => {
    render(<SaveSlot state="saved" lastSavedAt={new Date(0)} />);
    expect(screen.getByText('saved')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.queryByText('saved')).toBeNull();
  });
  it('keeps Save failed visible', () => {
    render(<SaveSlot state="error" lastSavedAt={null} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('saveFailed')).toBeInTheDocument();
  });
  it('renders nothing when hidden', () => {
    const { container } = render(<SaveSlot state="saved" lastSavedAt={null} hidden />);
    expect(container.firstChild).toBeNull();
  });
});
