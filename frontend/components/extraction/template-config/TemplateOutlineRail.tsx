import {Plus} from 'lucide-react';

import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import type {GridSection} from './templateTree';

/**
 * 200px outline rail (spec §2): every section, nested entries indented,
 * per-section field counts, and zero-match entries dimmed while a search
 * filter is active.
 */
interface TemplateOutlineRailProps {
  sections: GridSection[];
  /** Sections still present after filtering — others render dimmed. */
  visibleSectionIds: ReadonlySet<string>;
  selectedSectionId: string | null;
  onSelectSection: (sectionId: string) => void;
  onAddSection: () => void;
  isFiltering: boolean;
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
        'flex w-full items-center gap-1.5 rounded-[5px] px-1.5 py-[3px] text-left text-muted-foreground',
        'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        nested && 'ml-3.5 text-[10.5px]',
        selected && 'bg-muted/60 text-foreground',
        dimmed && 'opacity-40',
      )}
    >
      {nested && <span aria-hidden>↳</span>}
      <span className="min-w-0 flex-1 truncate">{section.label}</span>
      {section.hasDescription && (
        <span className="shrink-0 text-primary" aria-hidden>
          ●
        </span>
      )}
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
}: TemplateOutlineRailProps) {
  return (
    <nav
      aria-label={t('extraction', 'configHeaderTitle')}
      className="w-[200px] shrink-0 space-y-px overflow-y-auto border-r bg-muted/20 p-2 text-[11px]"
    >
      {sections.map((section) => (
        <div key={section.id} className="space-y-px">
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
        className="mt-1.5 flex w-full items-center gap-1 rounded-[5px] px-1.5 py-[3px] italic text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-3" aria-hidden />
        {t('extraction', 'gridNewSection')}
      </button>
    </nav>
  );
}
