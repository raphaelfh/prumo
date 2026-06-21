import { useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, ChevronDown } from 'lucide-react';
import { ProjectContext } from '@/contexts/ProjectContext';
import { useProjectMemberRole } from '@/hooks/useProjectMemberRole';
import { getSectionViews } from '@/components/layout/sectionViews';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

export function SectionViewSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectContext = useContext(ProjectContext);
  const activeSection = projectContext?.activeTab ?? '';
  const projectId = projectContext?.project?.id ?? '';
  const hasViews = activeSection === 'extraction' || activeSection === 'quality';
  const { isManager } = useProjectMemberRole(hasViews ? projectId : '');

  const views = getSectionViews(activeSection).filter((v) => !v.managerOnly || isManager);
  if (views.length === 0) return null;

  const urlParam = views[0].urlParam;
  const fromUrl = searchParams.get(urlParam);
  const active = views.some((v) => v.value === fromUrl) ? (fromUrl as string) : views[0].value;
  const activeLabel = views.find((v) => v.value === active)?.label ?? views[0].label;

  const select = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(urlParam, value);
    setSearchParams(next, { replace: true });
  };

  const ariaLabel =
    activeSection === 'quality'
      ? t('navigation', 'viewsQualityAria')
      : t('navigation', 'viewsExtractionAria');

  return (
    <>
      {/* Segmented control — comfortable widths and up. Hidden (display:none)
          below 34rem so only one control is in the a11y tree at a time. */}
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="hidden items-center gap-0.5 rounded-md bg-muted/40 p-0.5 @[34rem]/headerbar:flex"
      >
        {views.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active === value}
            data-testid={activeSection === 'quality' ? `hitl-quality_assessment-tab-${value}` : undefined}
            onClick={() => select(value)}
            className={cn(
              'h-7 rounded px-3 text-header-meta font-medium transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11',
              active === value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Collapsed dropdown — compact widths only (hidden at 34rem and up). */}
      <div className="@[34rem]/headerbar:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="header" variant="outline" className="gap-1.5">
              {activeLabel}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {views.map(({ value, label }) => (
              <DropdownMenuItem key={value} onSelect={() => select(value)} aria-current={active === value}>
                {label}
                {active === value && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
