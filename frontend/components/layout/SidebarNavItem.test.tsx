import {describe, it, expect, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {FileText} from 'lucide-react';
import {SidebarNavItem} from './SidebarNavItem';

describe('SidebarNavItem', () => {
  it('renders label and shortcut badge', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcut="A" active={false} onClick={vi.fn()} />);
    expect(screen.getByText('Articles')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('marks active item with aria-current', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcut="A" active onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'page');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<SidebarNavItem icon={FileText} label="Articles" shortcut="A" active={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes aria-keyshortcuts as G then letter', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcut="A" active={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-keyshortcuts', 'G A');
  });

  it('hides the shortcut chip at rest and reveals it on hover and keyboard focus', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcut="A" active={false} onClick={vi.fn()} />);
    const chip = screen.getByText('A').parentElement as HTMLElement;
    expect(chip.className).toContain('opacity-0');
    expect(chip.className).toContain('group-hover:opacity-100');
    expect(chip.className).toContain('group-focus-visible:opacity-100');
  });
});
