/**
 * Markdown preprocessing for the document reader.
 *
 * The parse pipeline (LlamaParse) emits article markdown that carries a few
 * artifacts that should not reach the renderer verbatim:
 *
 *   - `<page_number>03</page_number>` page markers (the reader already shows a
 *     per-page "Page N" header, so these are noise).
 *   - Flow diagrams flattened to bare `graph TD ...` / `flowchart LR ...` text
 *     that is neither fenced nor a paragraph the user wants to read inline.
 *
 * This module is a pure, deterministic string→string transform — no IO, no
 * React — so it is trivially unit-testable and reused by both the reader and
 * its tests. Rendering (react-markdown + plugins + mermaid) lives in
 * `MarkdownContent.tsx`.
 */

/** `<page_number>…</page_number>` (and stray unclosed variants). */
const PAGE_NUMBER_BLOCK = /<page_number>[\s\S]*?<\/page_number>/gi;
const PAGE_NUMBER_STRAY = /<\/?page_number>/gi;

/**
 * First-line patterns that unambiguously start a Mermaid diagram. Kept strict
 * (direction token for graph/flowchart; exact diagram keyword otherwise) so an
 * English sentence opening with "graph" or "pie" is never mistaken for a
 * diagram.
 */
const MERMAID_FIRST_LINE =
  /^(?:(?:graph|flowchart)\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|gantt\b|pie\b|journey\b|gitGraph\b|mindmap\b|timeline\b|quadrantChart\b|xychart-beta\b)/;

/** True when `value` looks like a bare (un-fenced) Mermaid diagram body. */
export function looksLikeMermaid(value: string): boolean {
  const firstLine = value.trimStart().split('\n', 1)[0]?.trim() ?? '';
  return MERMAID_FIRST_LINE.test(firstLine);
}

/**
 * Strip page-number artifacts and wrap a bare leading Mermaid diagram in a
 * ```mermaid fence so the renderer treats it as a diagram (with a graceful
 * fallback to its source when Mermaid cannot parse it).
 *
 * Idempotent: running it twice yields the same output.
 */
export function preprocessMarkdown(raw: string): string {
  if (!raw) return '';

  let out = raw.replace(PAGE_NUMBER_BLOCK, '').replace(PAGE_NUMBER_STRAY, '');

  // Collapse the blank lines a removed page marker may leave behind.
  out = out.replace(/\n{3,}/g, '\n\n').trim();

  // Only auto-fence when the WHOLE block is a bare diagram (not already fenced)
  // — never rewrite prose that merely contains a diagram-like word mid-text.
  if (!out.includes('```') && looksLikeMermaid(out)) {
    out = '```mermaid\n' + out + '\n```';
  }

  return out;
}
