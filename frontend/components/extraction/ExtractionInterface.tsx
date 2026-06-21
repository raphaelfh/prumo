/**
 * Main interface for data extraction
 *
 * Manages the full data extraction flow for a project,
 * including templates, instances and values.
 */

import {useEffect, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {Skeleton} from '@/components/ui/skeleton';
import {AlertCircle, Download, PlusCircle, Settings} from 'lucide-react';
import {
    type ProjectTemplate,
    useHITLProjectTemplates,
} from '@/hooks/hitl/useHITLProjectTemplates';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {useArticleExtractionValues} from '@/hooks/extraction/useArticleExtractionValues';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {computeRowProgress} from '@/lib/extraction/progress';
import {ArticleExtractionTable} from './ArticleExtractionTable';
import {ConfigureTemplateFirst} from './config/ConfigureTemplateFirst';
import {ExtractionExportDialog} from './ExtractionExportDialog';
import {TemplateConfigEditor} from './TemplateConfigEditor';
import {useAuth} from '@/contexts/AuthContext';
import {CreateCustomTemplateDialog, ImportTemplateDialog} from './dialogs';
import {loadProjectArticles} from '@/services/articlesService';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

interface ExtractionInterfaceProps {
  projectId: string;
}

export function ExtractionInterface({ projectId }: ExtractionInterfaceProps) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

    // Read tab from URL or use default
  const tabFromUrl = searchParams.get('extractionTab') as 'extraction' | 'dashboard' | 'configuration' | null;
  const initialTab = (tabFromUrl && ['extraction', 'dashboard', 'configuration'].includes(tabFromUrl)) 
    ? tabFromUrl 
    : 'extraction';
  
  const [activeTemplate, setActiveTemplate] = useState<ProjectTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<'extraction' | 'dashboard' | 'configuration'>(initialTab);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showCreateCustomDialog, setShowCreateCustomDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [articles, setArticles] = useState<any[]>([]);
  // Per-article values + required-field structure, shared with the list
  // tables. "Overall progress" below is the mean of the canonical per-article
  // completion (previously "% of articles touched").
  const { valuesByArticle } = useArticleExtractionValues(
    projectId,
    activeTemplate?.id,
    user?.id,
  );
  const { entityTypes } = useTemplateEntityTypes(activeTemplate?.id);

  const extractionStats = (() => {
    const totalArticles = articles.length;
    let completed = 0;
    let sum = 0;
    // Completeness distribution buckets for the dashboard bar.
    let empty = 0;
    let partial = 0;
    for (const article of articles) {
      const d = valuesByArticle.get(article.id);
      const pct = d ? computeRowProgress(d.instances, d.values, entityTypes) : 0;
      sum += pct;
      if (pct >= 100) completed += 1;
      else if (pct <= 0) empty += 1;
      else partial += 1;
    }
    return {
      totalArticles,
      extractionsStarted: valuesByArticle.size,
      extractionsCompleted: completed,
      progressPercentage: totalArticles > 0 ? Math.round(sum / totalArticles) : 0,
      distribution: { empty, partial, complete: completed },
    };
  })();

  // Completeness distribution segments for the dashboard bar (0% / 1–99% /
  // 100%), derived from the per-article pct already summed above.
  const dashboardBuckets = (() => {
    const { empty, partial, complete } = extractionStats.distribution;
    const total = extractionStats.totalArticles;
    const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
    return [
      {
        key: 'notStarted',
        count: empty,
        widthPct: pct(empty),
        bar: 'bg-muted-foreground/25',
        dot: 'bg-muted-foreground/40',
        label: t('extraction', 'dashboardBucketNotStarted'),
      },
      {
        key: 'inProgress',
        count: partial,
        widthPct: pct(partial),
        bar: 'bg-info',
        dot: 'bg-info',
        label: t('extraction', 'dashboardBucketInProgress'),
      },
      {
        key: 'complete',
        count: complete,
        widthPct: pct(complete),
        bar: 'bg-success',
        dot: 'bg-success',
        label: t('extraction', 'dashboardBucketComplete'),
      },
    ];
  })();

    // Hook to manage templates
  const {
    templates,
      globalTemplates,
    loading: templatesLoading,
    error: templatesError,
    refresh: refreshTemplates,
  } = useHITLProjectTemplates({ projectId, kind: 'extraction' });

    // Pre-select template when opening import dialog from config list
    const [importInitialTemplateId, setImportInitialTemplateId] = useState<string | null>(null);

    const {isManager, loading: roleLoading} = useProjectMemberRole(projectId);

    // Keep the active template in sync with the template list (adjusted
    // during render instead of via effect; the null sentinel makes the
    // first render perform the initial selection).
  const [prevTemplates, setPrevTemplates] = useState<ProjectTemplate[] | null>(null);
  if (templates !== prevTemplates) {
    setPrevTemplates(templates);
    if (templates.length > 0) {
      if (!activeTemplate) {
          // If no active template, select the default
        const defaultTemplate = templates.find(t => t.is_active) || templates[0];
        setActiveTemplate(defaultTemplate);
      } else {
          // Check if active template still exists in the list
        const currentTemplate = templates.find(t => t.id === activeTemplate.id);
        if (!currentTemplate) {
            // Template was removed or recreated; use the latest
          const defaultTemplate = templates.find(t => t.is_active) || templates[0];
          if (defaultTemplate) {
            setActiveTemplate(defaultTemplate);
          }
        }
      }
    }
  }

    // Non-manager cannot access Configuration: clamp back to extraction.
    // Render-phase invariant — the guard guarantees termination.
    if (!roleLoading && !isManager && activeTab === 'configuration') {
        setActiveTab('extraction');
    }

    // Sync activeTab FROM URL when bar (ProjectView) changes extractionTab param
    // (adjusted during render instead of via effect).
    const [prevSearchParams, setPrevSearchParams] = useState(searchParams);
    if (searchParams !== prevSearchParams) {
        setPrevSearchParams(searchParams);
        const urlTab = searchParams.get('extractionTab') as 'extraction' | 'dashboard' | 'configuration' | null;
        const valid = urlTab && ['extraction', 'dashboard', 'configuration'].includes(urlTab);
        if (valid && urlTab !== activeTab) {
            setActiveTab(urlTab);
        }
    }

    // Sync active tab with URL
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('extractionTab', activeTab);
    setSearchParams(newParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

    // Change tab and update URL
  const handleTabChange = (tab: 'extraction' | 'dashboard' | 'configuration') => {
    setActiveTab(tab);
  };

  const loadArticles = async () => {
    const result = await loadProjectArticles(projectId);
    if (!result.ok) {
      console.error("Error loading articles:", result.error);
      toast.error(t('extraction', 'errorLoadArticles'));
      return;
    }
    setArticles(result.data);
  };

    // Load articles and statistics
  useEffect(() => {
    if (projectId) {
      // Microtask so the loader's setState calls run in an async callback.
      queueMicrotask(() => void loadArticles());
    }
  }, [projectId]);


    // Render Dashboard tab
  const renderDashboard = () => (
      <div className="space-y-4">
          {/* Dense stat strip — one bordered row of figures (replaces the
              three oversized single-number cards). */}
          <Card className="border-border/40 shadow-elev-popover">
              <CardContent className="p-0">
                  <div className="grid grid-cols-2 divide-x divide-y divide-border/40 sm:grid-cols-4 sm:divide-y-0">
                      <div className="px-4 py-3">
                          <div className="text-xl font-semibold tabular-nums">{extractionStats.totalArticles}</div>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('extraction', 'dashboardArticles')}</p>
                      </div>
                      <div className="px-4 py-3">
                          <div className="text-xl font-semibold tabular-nums">{extractionStats.extractionsStarted}</div>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('extraction', 'dashboardStatInExtraction')}</p>
                      </div>
                      <div className="px-4 py-3">
                          <div className="text-xl font-semibold tabular-nums">{extractionStats.extractionsCompleted}</div>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('extraction', 'dashboardStatCompleted')}</p>
                      </div>
                      <div className="px-4 py-3">
                          <div className="text-xl font-semibold tabular-nums">{extractionStats.progressPercentage}%</div>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('extraction', 'dashboardStatAvgCompleteness')}</p>
                      </div>
                  </div>
              </CardContent>
          </Card>

          {/* Completeness distribution: 0% / 1–99% / 100% across all articles. */}
          <Card className="border-border/40 shadow-elev-popover">
              <CardHeader className="px-4 pt-4 pb-2">
                  <CardTitle className="text-[13px] font-medium">{t('extraction', 'dashboardDistributionTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2.5">
                  <div
                      className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={t('extraction', 'dashboardDistributionTitle')}
                  >
                      {dashboardBuckets.map((b) =>
                          b.count > 0 ? (
                              <div key={b.key} className={b.bar} style={{width: `${b.widthPct}%`}}/>
                          ) : null,
                      )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {dashboardBuckets.map((b) => (
                          <div key={b.key} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                              <span className={`h-2 w-2 rounded-full ${b.dot}`} aria-hidden="true"/>
                              <span>{b.label}</span>
                              <span className="font-medium text-foreground tabular-nums">{b.count}</span>
                          </div>
                      ))}
                  </div>
              </CardContent>
          </Card>

      {!activeTemplate && !templatesLoading && (
          <Card className="border-info/30 bg-info/5">
              <CardContent className="pt-4 pb-4 px-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start space-x-3">
                  <Settings className="h-4 w-4 text-info mt-0.5 shrink-0" strokeWidth={1.5}/>
                <div>
                    <p className="text-[13px] font-medium text-foreground">{t('extraction', 'dashboardConfigureTitle')}</p>
                    <p className="text-[13px] text-muted-foreground mt-1">
                        {t('extraction', 'dashboardConfigureDesc')}
                  </p>
                  <div className="mt-3 space-y-2">
                      <p className="text-[13px] text-foreground font-medium">{t('extraction', 'dashboardYouCan')}</p>
                      <ul className="text-[13px] text-muted-foreground space-y-1 ml-4">
                          <li>• {t('extraction', 'dashboardImportCharmsOption')}</li>
                          <li>• {t('extraction', 'dashboardCreateSectionsOption')}</li>
                    </ul>
                  </div>
                </div>
              </div>
                      <Button onClick={() => setActiveTab('configuration')} className="w-full sm:w-auto sm:ml-4">
                    <Settings className="h-4 w-4 mr-2" strokeWidth={1.5}/>
                    {t('extraction', 'dashboardConfigureButton')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

    // Render tab content (only when not loading templates)
  const renderTabContent = () => {
      if (templatesLoading) {
          return null;
      }
    switch (activeTab) {
      case 'extraction':
        return activeTemplate ? (
          <ArticleExtractionTable
            projectId={projectId}
            templateId={activeTemplate.id}
            toolbarActions={
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground"
                      onClick={() => setShowExportDialog(true)}
                      disabled={articles.length === 0}
                      data-testid="extraction-export-button"
                      aria-label={t('extraction', 'exportButton')}
                    >
                      <Download className="h-4 w-4" strokeWidth={1.5}/>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('extraction', 'exportButton')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            }
          />
        ) : isManager ? (
            <ConfigureTemplateFirst onConfigureClick={() => setActiveTab('configuration')}/>
        ) : (
            <Card className="border-border/40 shadow-elev-popover rounded-md w-full">
                <CardContent className="pt-6 pb-6">
                    <div className="flex items-start gap-3 text-[13px] text-muted-foreground">
                        <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.5}/>
                        <p>{t('extraction', 'configContactManagerToConfigure')}</p>
                    </div>
            </CardContent>
          </Card>
        );
      
      case 'dashboard':
        return renderDashboard();
      
      case 'configuration':
        return activeTemplate ? (
          <TemplateConfigEditor
            projectId={projectId}
            templateId={activeTemplate.id}
          />
        ) : (
            <Card className="border-border/40 shadow-elev-popover rounded-md w-full">
                <CardHeader className="pb-2">
                    <CardTitle
                        className="text-[13px] font-medium text-foreground">{t('extraction', 'configPanelTitle')}</CardTitle>
                    <CardDescription className="text-[13px] text-muted-foreground">
                        {t('extraction', 'configPanelDesc')}
              </CardDescription>
            </CardHeader>
                <CardContent className="space-y-4">
                    {/* 1. Create Custom Template (primary action first) */}
                    <div
                        className="border border-border/40 rounded-lg p-4 hover:bg-muted/50 transition-colors duration-75">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                        <PlusCircle className="h-4 w-4 text-primary" strokeWidth={1.5}/>
                        <h3 className="text-[13px] font-semibold">{t('extraction', 'configCreateCustomTitle')}</h3>
                    </div>
                      <p className="text-[13px] text-muted-foreground">
                          {t('extraction', 'configCreateCustomFullDesc')}
                    </p>
                  </div>
                    <Button
                        variant="outline"
                        className="w-full sm:w-auto sm:ml-4"
                    onClick={() => setShowCreateCustomDialog(true)}
                  >
                        <PlusCircle className="h-4 w-4 mr-2" strokeWidth={1.5}/>
                        {t('extraction', 'configCreateTemplateButton')}
                  </Button>
                </div>
              </div>

                    {/* 2. Manager info */}
                    <div className="bg-info/5 border border-info/30 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                    <AlertCircle className="h-4 w-4 text-info mt-0.5 shrink-0" strokeWidth={1.5}/>
                    <div className="text-[13px] text-foreground">
                        <p className="font-medium mb-1">{t('extraction', 'configManagersNote')}</p>
                    <p className="text-muted-foreground">
                        {t('extraction', 'configManagersNoteDesc')}
                    </p>
                  </div>
                </div>
              </div>

                    {/* 3. Import template (at bottom) */}
                    <div className="space-y-2" role="region" aria-labelledby="config-import-section-heading">
                        <h3 id="config-import-section-heading"
                            className="text-[13px] font-medium text-foreground">{t('extraction', 'configImportSectionTitle')}</h3>
                        {globalTemplates.length > 0 ? (
                            <div className="rounded-md border border-border/40 overflow-hidden min-w-0">
                                <div className="max-h-[280px] overflow-y-auto overflow-x-auto min-w-0"
                                     aria-label={t('extraction', 'configAvailableTemplates')}>
                                    <table className="w-full text-[13px] border-collapse">
                                        <thead className="sticky top-0 bg-muted/30 border-b border-border/40 z-10">
                                        <tr>
                                            <th className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-left py-2 px-3 w-[20%]">Name</th>
                                            <th className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-left py-2 px-3">Description</th>
                                            <th className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-left py-2 px-3 w-[12%]">Framework</th>
                                            <th className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right py-2 px-3 w-[80px]">Action</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {globalTemplates.map((gt) => (
                                            <tr
                                                key={gt.id}
                                                className="group border-b border-border/40 last:border-b-0 hover:bg-muted/50 transition-colors duration-75"
                                            >
                                                <td className="py-2 px-3 font-medium text-foreground">{gt.name}</td>
                                                <td className="py-2 px-3 text-muted-foreground line-clamp-2 max-w-[40ch]">{gt.description ?? '—'}</td>
                                                <td className="py-2 px-3">
                                <span
                                    className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-1.5 py-0.5 rounded border border-border/40"
                                    aria-hidden="true">
                                  {gt.framework}
                                </span>
                                                </td>
                                                <td className="py-2 px-3 text-right">
                                                    <Button
                                                        size="sm"
                                                        className="opacity-90 group-hover:opacity-100"
                                                        data-testid={`extraction-import-global-${gt.id}`}
                                                        aria-label={`${t('extraction', 'configImportThisTemplate')} ${gt.name}`}
                                                        onClick={() => {
                                                            setImportInitialTemplateId(gt.id);
                                                            setShowImportDialog(true);
                                                        }}
                                                    >
                                                        <Download className="h-4 w-4 mr-1.5" strokeWidth={1.5}/>
                                                        {t('extraction', 'configImportThisTemplate')}
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-md border border-border/40 p-4 text-center">
                                <p className="text-[13px] text-muted-foreground mb-2">{t('extraction', 'configNoTemplatesAvailable')}</p>
                                <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)}>
                                    {t('extraction', 'configSeeDetails')}
                                </Button>
                            </div>
                        )}
                    </div>
            </CardContent>
          </Card>
        );
      
      default:
        return activeTemplate ? (
          <ArticleExtractionTable 
            projectId={projectId} 
            templateId={activeTemplate.id}
          />
        ) : isManager ? (
            <ConfigureTemplateFirst onConfigureClick={() => setActiveTab('configuration')}/>
        ) : (
            <Card className="border-border/40 shadow-elev-popover rounded-md w-full">
                <CardContent className="pt-6 pb-6">
                    <div className="flex items-start gap-3 text-[13px] text-muted-foreground">
                        <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.5}/>
                        <p>{t('extraction', 'configContactManagerToConfigure')}</p>
                    </div>
                </CardContent>
            </Card>
        );
    }
  };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
                {templatesLoading ? (
                    <div className="space-y-4 px-0 py-2" aria-busy="true" aria-label={t('extraction', 'loadingTemplates')}>
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-9 flex-1 max-w-sm"/>
                            <Skeleton className="h-4 w-24"/>
                        </div>
                        <div className="rounded-lg border border-border/40">
                            <div className="border-b border-border/40 px-4 py-2 flex gap-4">
                                <Skeleton className="h-4 w-[30%]"/>
                                <Skeleton className="h-4 w-[15%]"/>
                                <Skeleton className="h-4 w-[10%]"/>
                                <Skeleton className="h-4 w-[15%]"/>
                                <Skeleton className="h-4 w-[10%]"/>
                                <Skeleton className="h-4 w-[15%]"/>
                            </div>
                            {[1, 2, 3, 4, 5, 6].map((i) => (
                                <div key={i} className="flex gap-4 px-4 py-2 border-b border-border/40 last:border-b-0">
                                    <Skeleton className="h-4 flex-1 max-w-[30%]"/>
                                    <Skeleton className="h-4 w-[15%]"/>
                                    <Skeleton className="h-4 w-[10%]"/>
                                    <Skeleton className="h-4 w-[15%]"/>
                                    <Skeleton className="h-4 w-[10%]"/>
                                    <Skeleton className="h-8 w-20"/>
                </div>
                            ))}
                        </div>
          </div>
                ) : activeTab === 'extraction' ? (
                    <div className="flex min-h-0 flex-1 flex-col">{renderTabContent()}</div>
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto pb-4">{renderTabContent()}</div>
                )}
            </div>

      {/* Error state */}
      {templatesError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div>
                  <p className="font-medium">{t('extraction', 'errorLoadTemplates')}</p>
                <p className="text-sm">{templatesError}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

            {/* Dialog to import global template */}
      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={(open) => {
            if (!open) setImportInitialTemplateId(null);
            setShowImportDialog(open);
        }}
        initialTemplateId={importInitialTemplateId}
        onTemplateImported={async (templateId?: string) => {
            setImportInitialTemplateId(null);
            // Refresh templates without reloading the page
          const updatedTemplates = await refreshTemplates() || [];
            // Stay on configuration tab
          handleTabChange('configuration');
            // Select the newly imported template
          if (templateId && updatedTemplates.length > 0) {
            const newTemplate = updatedTemplates.find((t: ProjectTemplate) => t.id === templateId);
            if (newTemplate) {
              setActiveTemplate(newTemplate);
            } else {
                // If not found by ID, select the most recent
              setActiveTemplate(updatedTemplates[0]);
            }
          } else if (updatedTemplates.length > 0) {
              // Select the most recent if no ID
            setActiveTemplate(updatedTemplates[0]);
          }
        }}
      />

            {/* Dialog to create custom template */}
      <CreateCustomTemplateDialog
        projectId={projectId}
        open={showCreateCustomDialog}
        onOpenChange={setShowCreateCustomDialog}
        onTemplateCreated={async (templateId?: string) => {
            // Refresh templates without reloading the page
          const updatedTemplates = await refreshTemplates() || [];
            // Stay on configuration tab
          handleTabChange('configuration');
            // Select the newly created template
          if (templateId && updatedTemplates.length > 0) {
            const newTemplate = updatedTemplates.find((t: ProjectTemplate) => t.id === templateId);
            if (newTemplate) {
              setActiveTemplate(newTemplate);
            } else {
                // If not found by ID, select the most recent
              setActiveTemplate(updatedTemplates[0]);
            }
          } else if (updatedTemplates.length > 0) {
              // Select the most recent if no ID
            setActiveTemplate(updatedTemplates[0]);
          }
        }}
      />

      {/* Dialog to export extraction data as .xlsx (009-extraction-excel-export) */}
      {activeTemplate && (
        <ExtractionExportDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          projectId={projectId}
          templateId={activeTemplate.id}
          currentListIds={articles.map((a) => a.id)}
          selectedIds={[]}
          isManager={isManager}
        />
      )}
    </div>
  );
}
