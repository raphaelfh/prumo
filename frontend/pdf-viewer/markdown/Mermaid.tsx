/**
 * Mermaid diagram renderer — lazy + fail-safe.
 *
 * `mermaid` is a heavy dependency (d3, dagre), so it is dynamically imported
 * on first use and never enters the main bundle. Parsed-document diagrams are
 * untrusted and frequently malformed (the parser flattens flow charts), so the
 * render is wrapped: any parse/render failure falls back to the diagram source
 * in a code block rather than throwing. `securityLevel: 'strict'` sanitizes the
 * emitted SVG.
 */
import {useEffect, useId, useState} from 'react';

// Initialise mermaid exactly once per session (idempotent guard).
let initialized = false;

async function loadMermaid() {
  const mod = await import('mermaid');
  const mermaid = mod.default;
  if (!initialized) {
    const dark =
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
      fontFamily: 'inherit',
    });
    initialized = true;
  }
  return mermaid;
}

export function Mermaid({code}: {code: string}) {
  // useId yields a colon-laden id; mermaid needs a DOM-id-safe string.
  const safeId = 'mermaid-' + useId().replace(/[^a-zA-Z0-9-]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // State is committed only in the async callbacks (never synchronously in
    // the effect body) so a `code` change keeps the prior diagram on screen
    // until the new one resolves — no loading flicker, no cascading render.
    loadMermaid()
      .then((mermaid) => mermaid.render(safeId, code))
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, safeId]);

  if (failed) {
    return (
      <pre className="my-3 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <code>{code}</code>
      </pre>
    );
  }

  if (svg == null) {
    return (
      <div
        className="my-3 rounded-md border bg-muted/30 p-4 text-xs text-muted-foreground"
        aria-busy="true"
      >
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="my-4 flex justify-center overflow-x-auto rounded-md border bg-background p-3 [&_svg]:h-auto [&_svg]:max-w-full"
      role="img"
      // Sanitized by mermaid (securityLevel: 'strict').
      dangerouslySetInnerHTML={{__html: svg}}
    />
  );
}
