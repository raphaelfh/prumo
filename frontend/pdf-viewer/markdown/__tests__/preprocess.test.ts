import {describe, expect, it} from 'vitest';
import {looksLikeMermaid, preprocessMarkdown} from '../preprocess';

describe('preprocessMarkdown', () => {
  it('returns empty string for falsy input', () => {
    expect(preprocessMarkdown('')).toBe('');
  });

  it('strips <page_number>…</page_number> markers and their content', () => {
    const input =
      'Frontiers in Digital Health <page_number>03</page_number> frontiersin.org';
    expect(preprocessMarkdown(input)).toBe(
      'Frontiers in Digital Health  frontiersin.org',
    );
  });

  it('removes stray unclosed page-number tags', () => {
    expect(preprocessMarkdown('abc </page_number> def')).toBe('abc  def');
  });

  it('preserves a GFM table verbatim (renderer handles it)', () => {
    const table = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(preprocessMarkdown(table)).toBe(table);
  });

  it('does not alter ordinary prose that mentions a diagram word', () => {
    const prose = 'The graph shows a clear upward trend across all cohorts.';
    expect(preprocessMarkdown(prose)).toBe(prose);
  });

  it('wraps a bare graph diagram in a mermaid fence', () => {
    const out = preprocessMarkdown('graph TD\nA --> B');
    expect(out).toBe('```mermaid\ngraph TD\nA --> B\n```');
  });

  it('wraps a bare flowchart LR diagram in a mermaid fence', () => {
    const out = preprocessMarkdown('flowchart LR\nA --> B');
    expect(out.startsWith('```mermaid\n')).toBe(true);
    expect(out.endsWith('\n```')).toBe(true);
  });

  it('does not double-fence already-fenced mermaid', () => {
    const fenced = '```mermaid\ngraph TD\nA --> B\n```';
    expect(preprocessMarkdown(fenced)).toBe(fenced);
  });

  it('is idempotent', () => {
    const input = 'Text <page_number>4</page_number> more\n\n\n\nend';
    const once = preprocessMarkdown(input);
    expect(preprocessMarkdown(once)).toBe(once);
  });
});

describe('looksLikeMermaid', () => {
  it.each([
    'graph TD',
    'graph LR\nA-->B',
    'flowchart TB',
    'sequenceDiagram',
    'stateDiagram-v2',
    'erDiagram',
    'gantt',
  ])('detects %j', (value) => {
    expect(looksLikeMermaid(value)).toBe(true);
  });

  it.each([
    'The graph below shows results',
    'A pie of the data',
    'graphene is a material',
    '| graph | value |',
  ])('rejects %j', (value) => {
    expect(looksLikeMermaid(value)).toBe(false);
  });
});
