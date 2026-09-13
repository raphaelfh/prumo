import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Button} from '@/components/ui/button';
import {SettingsActions, SettingsGroup, SettingsPage} from '@/components/settings';

describe('SettingsPage', () => {
  it('owns the readable column, the intro line and the settings container', () => {
    const {container} = render(
      <SettingsPage intro="Applies to every run."><SettingsGroup title="General">body</SettingsGroup></SettingsPage>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('mx-0', 'w-full', 'max-w-3xl');
    const intro = screen.getByText('Applies to every run.');
    expect(intro.tagName).toBe('P');
    expect(intro).toHaveClass('text-[13px]', 'text-muted-foreground');
    const body = root.lastElementChild as HTMLElement;
    expect(body).toHaveClass('@container/settings');
    expect(body).toContainElement(screen.getByRole('heading', {level: 2, name: 'General'}));
  });

  it('renders no intro paragraph without an intro', () => {
    const {container} = render(<SettingsPage><SettingsGroup>body</SettingsGroup></SettingsPage>);
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('SettingsGroup', () => {
  it('titles itself with an h2 and a hint trigger', () => {
    render(<SettingsGroup title="Shared keys" hint="Used by every member">body</SettingsGroup>);
    const heading = screen.getByRole('heading', {level: 2, name: 'Shared keys'});
    expect(heading).toHaveClass('text-[13px]', 'font-medium');
    expect(heading).not.toHaveClass('text-destructive');
    expect(screen.getByRole('button', {name: 'About Shared keys'})).toBeInTheDocument();
  });

  it('draws one hairline that the first group resets', () => {
    const {container} = render(<SettingsGroup>body</SettingsGroup>);
    expect(container.firstElementChild).toHaveClass(
      'border-t', 'border-border/40', 'pt-4', 'mt-4', 'first:border-t-0', 'first:pt-0', 'first:mt-0',
    );
  });

  it('colours a danger title', () => {
    render(<SettingsGroup title="Danger zone" tone="danger">body</SettingsGroup>);
    expect(screen.getByRole('heading', {level: 2})).toHaveClass('text-destructive');
  });

  it('stacks its body with space-y-1 and renders no heading when untitled', () => {
    render(<SettingsGroup><span>row</span></SettingsGroup>);
    expect(screen.getByText('row').parentElement).toHaveClass('space-y-1');
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('SettingsActions', () => {
  it('sits under the value column: same grid, empty label cell, wrapping buttons', () => {
    const {container} = render(
      <SettingsActions><Button>Save</Button><Button variant="ghost">Cancel</Button></SettingsActions>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('grid', 'gap-x-3', '@[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]');
    const [labelCell, valueCell] = Array.from(root.children) as HTMLElement[];
    expect(labelCell).toBeEmptyDOMElement();
    expect(valueCell).toHaveClass('flex', 'flex-wrap', 'gap-2');
    expect(valueCell).toContainElement(screen.getByRole('button', {name: 'Save'}));
  });
});
