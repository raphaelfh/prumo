/**
 * The protocol's screening criteria beside the record (spec §9): a collapsed
 * "Criteria (n)" disclosure above the reading column when the panel is docked,
 * an always-open rail when it is maximized. Nothing renders with no criteria.
 * Standalone so the full-text layout can mount it too.
 */
import {ChevronRight} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {t} from '@/lib/copy';

export interface ScreeningCriteria {
  inclusion: string[];
  exclusion: string[];
}

export function criteriaCount(criteria: ScreeningCriteria): number {
  return criteria.inclusion.length + criteria.exclusion.length;
}

function CriteriaGroup({title, items}: {title: string; items: string[]}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[13px] text-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function CriteriaLists({criteria}: {criteria: ScreeningCriteria}) {
  return (
    <div className="flex flex-col gap-3">
      <CriteriaGroup title={t('screening', 'criteriaInclusion')} items={criteria.inclusion} />
      <CriteriaGroup title={t('screening', 'criteriaExclusion')} items={criteria.exclusion} />
    </div>
  );
}

export function CriteriaPanel({criteria, variant}: {criteria: ScreeningCriteria; variant: 'rail' | 'disclosure'}) {
  const count = criteriaCount(criteria);
  if (count === 0) return null;

  if (variant === 'rail') {
    return (
      <aside
        aria-label={t('screening', 'criteriaRailLabel')}
        className="flex flex-col gap-3 self-start rounded-md border border-border/40 p-3 lg:sticky lg:top-4"
      >
        <CriteriaLists criteria={criteria} />
      </aside>
    );
  }

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button size="sm" variant="ghost" className="group -ml-2 text-muted-foreground">
          <ChevronRight
            className="mr-1 h-4 w-4 transition-transform duration-75 group-data-[state=open]:rotate-90"
            strokeWidth={1.5}
          />
          {t('screening', 'criteriaToggle').replace('{{n}}', String(count))}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pb-1">
        <CriteriaLists criteria={criteria} />
      </CollapsibleContent>
    </Collapsible>
  );
}
