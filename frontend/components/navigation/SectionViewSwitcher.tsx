import { useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProjectContext } from '@/contexts/ProjectContext';
import { useProjectMemberRole } from '@/hooks/useProjectMemberRole';
import { getSectionViews } from '@/components/layout/sectionViews';
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

  const select = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(urlParam, value);
    setSearchParams(next, { replace: true });
  };

  return (
    <div
      role="tablist"
      aria-label={activeSection === 'quality' ? t('navigation', 'viewsQualityAria') : t('navigation', 'viewsExtractionAria')}
      className="flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5"
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
            'h-7 rounded px-3 text-[12px] font-medium transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
