/**
 * pdf.js does not size the text layer itself: `TextLayer` writes per-span
 * custom properties and leaves the declarations that consume them to the
 * consuming app's stylesheet. Ours is hand-written (we do not ship pdf.js's
 * `pdf_viewer.css`), so a pdf.js upgrade that introduces a new property, or an
 * edit that drops one, silently detaches the invisible text from the glyphs on
 * the canvas — selection and character-precise search highlights then land on
 * the wrong words, with nothing failing.
 *
 * This is the guard: every custom property pdf.js's own stylesheet consumes for
 * text spans must also be consumed by ours.
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);

const ours = readFileSync(resolve(__dirname, '../primitives/text-layer.css'), 'utf8');
const pdfjs = readFileSync(
  resolve(require.resolve('pdfjs-dist/package.json'), '../web/pdf_viewer.css'),
  'utf8',
);

/**
 * pdf.js's own `.textLayer` rule block, up to its nested `.highlight` rule.
 * Whitespace-agnostic: pdf.js has shipped this stylesheet both minified
 * (`.textLayer{`) and formatted (`.textLayer {`). Throws rather than returning
 * an empty slice, so a format change cannot make the guard vacuous.
 */
function pdfjsTextLayerBlock(css: string): string {
  const start = css.search(/(^|[}\s])\.textLayer\s*\{/);
  if (start < 0) throw new Error('pdf_viewer.css: no `.textLayer {` rule found');
  const rest = css.slice(start);
  const end = rest.search(/\.highlight\s*\{/);
  if (end < 0) throw new Error('pdf_viewer.css: no `.highlight {` rule after `.textLayer`');
  return rest.slice(0, end);
}

/** The `--foo` names read (not merely declared) inside `.textLayer`'s rules. */
function consumedProperties(css: string): Set<string> {
  return new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
}

describe('the text-layer stylesheet', () => {
  it('guards the precondition: pdf.js really does hand sizing to the app stylesheet', () => {
    // If pdf.js ever sizes spans itself, `--font-height` disappears and this
    // whole test becomes vacuous rather than protective.
    const textLayer = pdfjsTextLayerBlock(pdfjs);
    expect(textLayer).toContain('--font-height');
    expect(textLayer).toContain('--scale-x');
  });

  it('consumes every custom property pdf.js expects the app to consume', () => {
    const theirs = consumedProperties(pdfjsTextLayerBlock(pdfjs));
    expect(theirs.size).toBeGreaterThan(0);
    const mine = consumedProperties(ours);
    const missing = [...theirs].filter((p) => !mine.has(p));
    expect(missing).toEqual([]);
  });

  it('sizes and scales the spans rather than leaving them at the browser default', () => {
    expect(ours).toMatch(/font-size:\s*calc\([^;]*--font-height/);
    expect(ours).toMatch(/transform:[^;]*scaleX\(var\(--scale-x\)\)/);
  });
});
