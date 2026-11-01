/**
 * RecordBody — the reading column: chips, title, byline, identifiers, the
 * abstract (structured when PubMed labelled it) and the MeSH/keyword lines.
 */
import {render, screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {RecordBody} from '@/components/screening/ScreeningParts';
import type {ScreeningAssignmentRead} from '@/services/screeningService';

type Article = ScreeningAssignmentRead['article'];

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'art1',
    title: 'Deep learning for sepsis',
    abstract: 'An abstract.',
    authors: ['Smith J'],
    doi: null,
    journal_title: 'Lancet',
    pmid: null,
    publication_year: 2021,
    mesh_terms: null,
    keywords: null,
    article_type: null,
    language: null,
    ...overrides,
  };
}

const STRUCTURED =
  'BACKGROUND: Sepsis is common.\n\nMETHODS: We randomised 120 adults.\n\nRESULTS: Mortality fell.\n\nCONCLUSIONS: Early triage helps.';

describe('RecordBody', () => {
  it('renders labelled sections for a structured abstract', () => {
    render(<RecordBody article={article({abstract: STRUCTURED})} />);
    const headings = screen.getAllByRole('heading', {level: 3}).map((h) => h.textContent);
    expect(headings).toEqual(['BACKGROUND', 'METHODS', 'RESULTS', 'CONCLUSIONS']);
    expect(screen.getByText('Mortality fell.')).toBeInTheDocument();
  });

  it('renders plain text for prose that looks like a label', () => {
    render(<RecordBody article={article({abstract: 'Note: x.\n\nMore.'})} />);
    expect(screen.queryByRole('heading', {level: 3})).not.toBeInTheDocument();
    expect(screen.getByText(/Note: x\./)).toBeInTheDocument();
  });

  it('links PMID and DOI in a new tab', () => {
    render(<RecordBody article={article({pmid: '123', doi: '10.1/x'})} />);
    const pmid = screen.getByRole('link', {name: '123'});
    const doi = screen.getByRole('link', {name: '10.1/x'});
    expect(pmid).toHaveAttribute('href', 'https://pubmed.ncbi.nlm.nih.gov/123/');
    expect(doi).toHaveAttribute('href', 'https://doi.org/10.1/x');
    for (const link of [pmid, doi]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
    expect(screen.getByText('PMID')).toBeInTheDocument();
    expect(screen.getByText('DOI')).toBeInTheDocument();
  });

  it('hides an identifier that is null', () => {
    render(<RecordBody article={article({pmid: '123', doi: null})} />);
    expect(screen.getByRole('link', {name: '123'})).toBeInTheDocument();
    expect(screen.queryByText('DOI')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('shows a language chip only for a non-English record', () => {
    const {unmount} = render(<RecordBody article={article({language: 'spa'})} />);
    expect(screen.getByTitle('Language: Spanish')).toHaveTextContent('Spanish');
    unmount();
    render(<RecordBody article={article({language: 'eng'})} />);
    expect(screen.queryByTitle(/^Language:/)).not.toBeInTheDocument();
  });

  it('shows a type chip unless it is a generic journal article', () => {
    const {unmount} = render(<RecordBody article={article({article_type: 'Randomized Controlled Trial'})} />);
    expect(screen.getByTitle('Article type: Randomized Controlled Trial')).toHaveTextContent(
      'Randomized Controlled Trial',
    );
    unmount();
    render(<RecordBody article={article({article_type: 'Journal Article'})} />);
    expect(screen.queryByTitle(/^Article type:/)).not.toBeInTheDocument();
  });

  it('shows MeSH and keyword lines, hidden when empty', () => {
    const {unmount} = render(
      <RecordBody article={article({mesh_terms: ['Sepsis', 'Humans'], keywords: ['triage', 'emergency']})} />,
    );
    expect(screen.getByText('MeSH').parentElement).toHaveTextContent('MeSH Sepsis · Humans');
    expect(screen.getByText('Keywords').parentElement).toHaveTextContent('Keywords triage · emergency');
    unmount();
    render(<RecordBody article={article({mesh_terms: [], keywords: null})} />);
    expect(screen.queryByText('MeSH')).not.toBeInTheDocument();
    expect(screen.queryByText('Keywords')).not.toBeInTheDocument();
  });

  it('constrains the reading column to 68ch at 15px', () => {
    const {container} = render(<RecordBody article={article()} />);
    const column = container.querySelector('article');
    expect(column).toHaveClass('max-w-[68ch]', 'text-[15px]');
  });

  it('shows "No abstract" with terms still listed', () => {
    render(<RecordBody article={article({abstract: null, mesh_terms: ['Sepsis']})} />);
    const column = screen.getByRole('article');
    expect(within(column).getByText('No abstract available')).toBeInTheDocument();
    expect(within(column).getByText('MeSH')).toBeInTheDocument();
  });
});
