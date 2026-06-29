import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';

describe('floating overlays', () => {
  it('renders dropdown content with a solid surface and viewport clamp', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const content = screen.getByText('item').closest('[role="menu"]')!;
    expect(content.className).toContain('bg-popover');
    expect(content.className).not.toContain('frosted-overlay');
    expect(content.className).toContain('shadow-elev-header');
    expect(content.className).toContain('max-w-[calc(100vw-1rem)]');
  });
});
