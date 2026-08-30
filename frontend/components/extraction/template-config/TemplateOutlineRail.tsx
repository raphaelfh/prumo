import {Plus} from 'lucide-react';

import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import {DescriptionDot} from './templateConfigAtoms';
import type {GridSection} from './templateTree';

/**
 * 216px outline rail (spec §2): every section, nested entries indented,
 * per-section field counts, and zero-match entries dimmed while a search
 * filter is active.
 *
 * Density note: rail rows sit at the compact tier (4px vertical / 8px
 * horizontal padding, 2px between rows). Anything tighter reads as one
 * glued block — the rows stop being separable at a glance, which is the
 * whole job of an outline. The 11px type is fixed by the surface's
 * three-size scale (gridDensity.test.ts), so legibility here is bought
 * with space and rail width, never with a fourth font size.
 */
interface TemplateOutlineRailProps {
  sections: GridSection[];
  /** Sections still present after filtering — others render dimmed. */
  visibleSectionIds: ReadonlySet<string>;
  selectedSectionId: string | null;
  onSelectSection: (sectionId: string) => void;
  onAddSection: () => void;
  isFiltering: boolean;
  className?: string;
  /** Dragged width (PaneResizer). Inline because it is a live pixel value
   * Tailwind cannot enumerate; it overrides the class-based default. */
  style?: React.CSSProperties;
}

function RailItem({
  section,
  nested,
  dimmed,
  selected,
  onSelect,
}: {
  section: GridSection;
  nested: boolean;
  dimmed: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground',
        'hover:bg-muted/50 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        nested && 'ml-3',
        selected && 'bg-muted/60 text-foreground',
        dimmed && 'opacity-40',
      )}
    >
      {nested && (
        <span aria-hidden className="shrink-0 text-muted-foreground/60">
          ↳
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{section.label}</span>
      {section.hasDescription && <DescriptionDot />}
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {section.fieldCount}
      </span>
    </button>
  );
}

export function TemplateOutlineRail({
  sections,
  visibleSectionIds,
  selectedSectionId,
  onSelectSection,
  onAddSection,
  isFiltering,
  className,
  style,
}: TemplateOutlineRailProps) {
  return (
    <nav
      aria-label={t('extraction', 'configHeaderTitle')}
      style={style}
      // No `border-r`: the PaneResizer beside it draws that hairline, and
      // two adjacent regions must never both draw the same separator.
      className={cn(
        'w-[216px] shrink-0 space-y-0.5 overflow-y-auto bg-muted/20 p-2 text-[11px]',
        className,
      )}
    >
      {sections.map((section) => (
        <div key={section.id} className="space-y-0.5">
          <RailItem
            section={section}
            nested={false}
            dimmed={isFiltering && !visibleSectionIds.has(section.id)}
            selected={selectedSectionId === section.id}
            onSelect={() => onSelectSection(section.id)}
          />
          {section.children.map((child) => (
            <RailItem
              key={child.id}
              section={child}
              nested
              dimmed={isFiltering && !visibleSectionIds.has(child.id)}
              selected={selectedSectionId === child.id}
              onSelect={() => onSelectSection(child.id)}
            />
          ))}
        </div>
      ))}

      <button
        type="button"
        onClick={onAddSection}
        className="mt-1 flex min-h-7 w-full items-center gap-1.5 rounded-md px-2 py-1 italic text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-3.5 shrink-0" aria-hidden />
        {t('extraction', 'gridNewSection')}
      </button>
    </nav>
  );
}
