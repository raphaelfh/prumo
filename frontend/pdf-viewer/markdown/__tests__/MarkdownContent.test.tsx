import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {MarkdownContent} from '../MarkdownContent';

describe('MarkdownContent', () => {
  it('renders a GFM table as a real <table>', () => {
    const md = '| Inclusion | Exclusion |\n| --- | --- |\n| Age ≥ 18 | Pregnancy |';
    render(<MarkdownContent>{md}</MarkdownContent>);
    const table = document.querySelector('table');
    expect(table).not.toBeNull();
    expect(screen.getByText('Inclusion')).toBeInTheDocument();
    expect(screen.getByText('Age ≥ 18')).toBeInTheDocument();
  });

  it('renders headings, bold and lists semantically', () => {
    const md = '# Methods\n\nThis is **bold** text.\n\n- one\n- two';
    render(<MarkdownContent>{md}</MarkdownContent>);
    expect(screen.getByRole('heading', {name: 'Methods'})).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('strips <page_number> artifacts before rendering', () => {
    render(
      <MarkdownContent>
        {'Frontiers <page_number>03</page_number> org'}
      </MarkdownContent>,
    );
    expect(document.body.textContent).not.toContain('page_number');
    expect(document.body.textContent).not.toContain('03');
  });

  it('does not render raw HTML (XSS-safe)', () => {
    render(<MarkdownContent>{'<img src=x onerror=alert(1)>hello'}</MarkdownContent>);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/hello/)).toBeInTheDocument();
  });

  it('opens links in a new tab with a safe rel', () => {
    render(<MarkdownContent>{'[link](https://example.com)'}</MarkdownContent>);
    const a = screen.getByRole('link', {name: 'link'});
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });
});
