/**
 * MarkdownContent — professional markdown rendering for the document reader.
 *
 * Renders parsed-article markdown (LlamaParse output) with:
 *   - GFM: tables, task lists, strikethrough, autolinks (`remark-gfm`)
 *   - Math: `$…$` / `$$…$$` via KaTeX (`remark-math` + `rehype-katex`)
 *   - Diagrams: ```mermaid fences (and bare flow charts, fenced by
 *     `preprocessMarkdown`) via the lazy, fail-safe `Mermaid` component
 *
 * Security: `react-markdown` does NOT render raw HTML by default (no
 * `rehype-raw`), so embedded markup in untrusted parsed text is inert. Links
 * open in a new tab with `rel="noreferrer noopener"`.
 *
 * Styling: Tailwind Typography (`prose`) tuned to the design tokens so it reads
 * as product UI, not a default markdown dump.
 */
import type {ComponentPropsWithoutRef} from 'react';
import ReactMarkdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import {preprocessMarkdown} from './preprocess';
import {Mermaid} from './Mermaid';

// Module-stable plugin arrays — avoids re-allocating on every render.
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

// Typography tuned to design tokens. `prose-sm` for density; tokens mapped so
// it inherits the minimalist dark/light theme rather than prose's gray scale.
const PROSE_CLASS = [
  'prose prose-sm dark:prose-invert max-w-none',
  'prose-headings:font-semibold prose-headings:text-foreground prose-headings:scroll-mt-4',
  'prose-p:text-foreground/90 prose-p:my-2 prose-p:leading-relaxed',
  'prose-strong:text-foreground prose-strong:font-semibold',
  'prose-a:text-primary prose-a:font-normal hover:prose-a:underline',
  'prose-li:text-foreground/90 prose-li:my-0.5',
  'prose-blockquote:text-muted-foreground prose-blockquote:border-l-primary/30',
  'prose-hr:border-border',
  'prose-table:my-0 prose-th:text-foreground prose-th:font-medium prose-td:text-foreground/90',
  'prose-img:rounded-md prose-img:border',
].join(' ');

function CodeBlock({className, children}: ComponentPropsWithoutRef<'code'>) {
  const lang = /language-(\w+)/.exec(className ?? '')?.[1];
  const text = String(children ?? '').replace(/\n$/, '');
  // Inline code: no language and single-line.
  if (!lang && !text.includes('\n')) {
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
        {children}
      </code>
    );
  }
  if (lang === 'mermaid') {
    return <Mermaid code={text} />;
  }
  return (
    <pre className="my-3 overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
      <code>{text}</code>
    </pre>
  );
}

const COMPONENTS: Components = {
  // Block rendering is owned by `code` (above); unwrap the default <pre> so we
  // don't get <pre><pre> / <pre><div(mermaid)> nesting.
  pre: ({children}) => <>{children}</>,
  code: CodeBlock,
  a: ({href, children}) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  // Wide clinical tables must scroll horizontally rather than overflow the pane.
  table: ({children}) => (
    <div className="my-3 overflow-x-auto rounded-md border">
      <table className="my-0 w-full text-xs">{children}</table>
    </div>
  ),
};

export interface MarkdownContentProps {
  children: string;
  className?: string;
}

export function MarkdownContent({children, className}: MarkdownContentProps) {
  const source = preprocessMarkdown(children);
  return (
    <div className={className ? `${PROSE_CLASS} ${className}` : PROSE_CLASS}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
