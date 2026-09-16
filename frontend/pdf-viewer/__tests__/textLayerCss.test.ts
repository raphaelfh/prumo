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

/** The `--foo` names read (not merely declared) inside `.textLayer`'s rules. */
function consumedProperties(css: string): Set<string> {
  return new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
}

describe('the text-layer stylesheet', () => {
  it('guards the precondition: pdf.js really does hand sizing to the app stylesheet', () => {
    // If pdf.js ever sizes spans itself, `--font-height` disappears and this
    // whole test becomes vacuous rather than protective.
    const textLayer = pdfjs.slice(pdfjs.indexOf('.textLayer{'));
    expect(textLayer).toContain('--font-height');
    expect(textLayer).toContain('--scale-x');
  });

  it('consumes every custom property pdf.js expects the app to consume', () => {
    const theirs = consumedProperties(pdfjs.slice(pdfjs.indexOf('.textLayer{'), pdfjs.indexOf('.highlight{')));
    const mine = consumedProperties(ours);
    const missing = [...theirs].filter((p) => !mine.has(p));
    expect(missing).toEqual([]);
  });

  it('sizes and scales the spans rather than leaving them at the browser default', () => {
    expect(ours).toMatch(/font-size:\s*calc\([^;]*--font-height/);
    expect(ours).toMatch(/transform:[^;]*scaleX\(var\(--scale-x\)\)/);
  });
});
