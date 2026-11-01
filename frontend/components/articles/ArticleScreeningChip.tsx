/**
 * An article's screening stage in the Articles list: "<phase> · <status>" while
 * the status is open or provisional, the bare status once terminal. Blank
 * while the stage is unknown (screening unconfigured, loading, failed read, or
 * an article the read does not carry).
 */
import {useArticleScreeningStages} from '@/hooks/screening/useArticleScreeningStages';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

export function ArticleScreeningChip({projectId, articleId}: {projectId: string; articleId: string}) {
  const stage = useArticleScreeningStages(projectId).stageOf(articleId);
  if (!stage) return null;

  const label = t('screening', stage.label);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-none',
        stage.tone,
      )}
    >
      <span className="truncate">{stage.prefix ? `${t('screening', stage.prefix)} · ${label}` : label}</span>
    </span>
  );
}
