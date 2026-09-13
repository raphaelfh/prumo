import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {SettingsRow} from '@/components/settings';

describe('SettingsRow', () => {
  it('associates its label with the control through htmlFor', () => {
    render(<SettingsRow label="Project name" htmlFor="project_name"><input id="project_name" /></SettingsRow>);
    expect(screen.getByRole('textbox', {name: 'Project name'})).toHaveAttribute('id', 'project_name');
  });

  it('keeps the hint trigger beside the label, so the control is named by the label alone', () => {
    render(
      <SettingsRow label="Project name" htmlFor="project_name" hint="Shown to reviewers">
        {({describedBy}) => <input id="project_name" aria-describedby={describedBy} />}
      </SettingsRow>,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAccessibleName('Project name');
    expect(screen.getByRole('button', {name: 'About Project name'}).closest('label')).toBeNull();
    expect(input).toHaveAttribute('aria-describedby', 'project_name-hint');
    expect(input).toHaveAccessibleDescription('Shown to reviewers');
  });

  it('appends the error id after the hint id and renders the message', () => {
    render(
      <SettingsRow label="Arbitrator" htmlFor="arbitrator" hint="Breaks ties" error="Choose an arbitrator">
        {({describedBy}) => <input id="arbitrator" aria-describedby={describedBy} />}
      </SettingsRow>,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-describedby', 'arbitrator-hint arbitrator-error');
    const message = screen.getByText('Choose an arbitrator');
    expect(message).toHaveAttribute('id', 'arbitrator-error');
    expect(message).toHaveClass('text-xs', 'text-destructive');
  });

  it('hands the render-prop no describedBy when there is neither hint nor error', () => {
    render(<SettingsRow label="Label" htmlFor="l">{({describedBy}) => <input id="l" aria-describedby={describedBy} />}</SettingsRow>);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  });

  it('marks required with an asterisk that stays out of the accessible name', () => {
    render(<SettingsRow label="Project name" htmlFor="n" required><input id="n" /></SettingsRow>);
    expect(screen.getByRole('textbox', {name: 'Project name'})).toBeInTheDocument();
    expect(screen.getByText('*')).toHaveClass('text-destructive');
  });

  it('generates ids for a row with no control (no htmlFor)', () => {
    render(<SettingsRow label="Email" hint="Used to sign in"><span>me@example.com</span></SettingsRow>);
    expect(screen.getByText('Email').tagName).toBe('LABEL');
    expect(screen.getByText('Email')).not.toHaveAttribute('for');
    expect(document.querySelector('[id$="-hint"]')).toHaveTextContent('Used to sign in');
  });

  it('lays out on the settings container query, not a viewport breakpoint', () => {
    const {container} = render(<SettingsRow label="A" htmlFor="a"><input id="a" /></SettingsRow>);
    const row = container.firstElementChild as HTMLElement;
    expect(row).toHaveClass('grid', 'gap-x-3', 'gap-y-1', 'py-1', '@[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]', '@[36rem]/settings:items-center');
    expect(row.className).not.toMatch(/(^|\s)(sm|md|lg):/);
  });

  it('top-aligns with align="start"', () => {
    const {container} = render(<SettingsRow label="A" htmlFor="a" align="start"><textarea id="a" /></SettingsRow>);
    expect(container.firstElementChild).toHaveClass('@[36rem]/settings:items-start');
  });
});
