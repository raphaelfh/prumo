/**
 * Density contract for the template-config surface (spec 2026-08-28,
 * slice D). The grid had grown a private micro-scale — six font sizes,
 * five of them below the system's 11px floor — and 386 in-table controls
 * under the 24px minimum target size (WCAG 2.5.8).
 *
 * A source scan, not a render assertion: jsdom has no layout, so the
 * measured claims ("three sizes on screen", "no control under 24px") can
 * only be proven live in a browser. What CAN be pinned deterministically
 * is the vocabulary those measurements come from — the class strings.
 * Keeping it static also makes it a ratchet: a new `text-[10.5px]` fails
 * here long before anyone re-runs the live audit.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The Configuration surface: grid panel (toolbar + table + ghost rows),
 * outline rail, inspector. Sheets and dialogs launched FROM it (diff,
 * history, discard, move-to-section) are their own overlay surfaces at
 * the shadcn scale and stay out.
 */
const SURFACE = [
  'TemplateConfigGridPanel.tsx',
  'TemplateConfigToolbar.tsx',
  'TemplateGrid.tsx',
  'TemplateGridCellEditors.tsx',
  'TemplateGridFieldRow.tsx',
  'TemplateGridGhostRow.tsx',
  'TemplateGridSectionHeaderRow.tsx',
  'TemplateInspector.tsx',
  'TemplateInspectorSectionPane.tsx',
  'TemplateOutlineRail.tsx',
  'inspectorShared.tsx',
  'templateConfigAtoms.tsx',
  'PaneResizer.tsx',
] as const;

/** 11px secondary · 13px body · 14px pane titles — `frontend-ux` §Type. */
const ALLOWED_FONT_CLASSES = new Set(['text-[11px]', 'text-[13px]', 'text-sm']);

/** Every `text-*` that sets a SIZE (colors and weights share the prefix). */
const FONT_SIZE_CLASS =
  /\btext-(?:\[[\d.]+(?:px|rem)\]|xs|sm|base|lg|xl|\dxl)\b/g;

/** Tailwind spacing unit → px. `h-6` is 24px, the minimum target. */
const MIN_TARGET_PX = 24;
const FIXED_HEIGHT_CLASS = /\b(min-)?h-(?:\[(\d+)px\]|(\d+(?:\.5)?)\b)/g;

const read = (file: string) => readFileSync(resolve(here, file), 'utf-8');

/** Comments explain the rules; only emitted classes may break them. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe.each(SURFACE)('%s', (file) => {
  it('uses only the three system font sizes', () => {
    const offenders = [
      ...new Set(read(file).match(FONT_SIZE_CLASS) ?? []),
    ].filter((cls) => !ALLOWED_FONT_CLASSES.has(cls));
    expect(offenders).toEqual([]);
  });

  /**
   * Focus owns the outline, selection owns a tint (`frontend-ux` §4.6).
   * `gridCellFocus.CELL_RING` is the roving FOCUS ring and the ONLY place
   * this surface may write it: a row that re-used it for `selected` drew
   * two concentric 2px rules once focus landed on the same cell, and lied
   * about having focus the rest of the time.
   */
  it('never paints the focus-ring outline outside gridCellFocus', () => {
    expect(stripComments(read(file))).not.toContain('outline-ring');
  });

  it('declares no control height below the 24px minimum target', () => {
    const offenders: string[] = [];
    for (const [cls, , px, units] of read(file).matchAll(FIXED_HEIGHT_CLASS)) {
      // `min-h-0` and friends are layout primitives (flex children that
      // must be allowed to shrink), never a control's declared size.
      if (cls.startsWith('min-h-') && px === undefined) continue;
      const value = px !== undefined ? Number(px) : Number(units) * 4;
      if (value < MIN_TARGET_PX) offenders.push(cls);
    }
    expect(offenders).toEqual([]);
  });
});
