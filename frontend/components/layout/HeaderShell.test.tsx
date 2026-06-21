import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeaderShell } from './HeaderShell';

describe('HeaderShell', () => {
  it('declares its own header container and frosted surface', () => {
    render(<HeaderShell><span>child</span></HeaderShell>);
    const header = screen.getByText('child').closest('header');
    expect(header).not.toBeNull();
    expect(header!.className).toContain('@container/headerbar');
    expect(header!.className).toContain('frosted-header');
    expect(header!.className).toContain('z-header');
  });

  it('is sticky by default and relative when asked', () => {
    const { rerender } = render(<HeaderShell><span>a</span></HeaderShell>);
    expect(screen.getByText('a').closest('header')!.className).toContain('sticky');
    rerender(<HeaderShell position="relative"><span>a</span></HeaderShell>);
    expect(screen.getByText('a').closest('header')!.className).toContain('relative');
  });

  it('adds the elevation shadow only when lifted', () => {
    const { rerender } = render(<HeaderShell><span>a</span></HeaderShell>);
    expect(screen.getByText('a').closest('header')!.className).not.toContain('shadow-elev-header');
    rerender(<HeaderShell lifted><span>a</span></HeaderShell>);
    expect(screen.getByText('a').closest('header')!.className).toContain('shadow-elev-header');
  });
});
