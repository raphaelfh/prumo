/**
 * Card-based screening interface.
 *
 * Shows one article at a time with title, abstract, criteria checklist,
 * and include/exclude/maybe buttons with keyboard shortcuts.
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Checkbox} from '@/components/ui/checkbox';
import {Textarea} from '@/components/ui/textarea';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Minus,
    XCircle,
    HelpCircle,
    Brain,
} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {useScreeningConfig} from '@/hooks/screening/useScreeningConfig';
import {useScreeningDecisions} from '@/hooks/screening/useScreeningDecisions';
import {useScreeningProgress} from '@/hooks/screening/useScreeningProgress';
import type {Article} from '@/types/article';
import type {ScreeningCriterion} from '@/types/screening';

interface ScreeningCardViewProps {
    projectId: string;
    phase: 'title_abstract' | 'full_text';
}

export function ScreeningCardView({projectId, phase}: ScreeningCardViewProps) {
    const [articles, setArticles] = useState<Article[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [reason, setReason] = useState('');
    const [criteriaResponses, setCriteriaResponses] = useState<Record<string, boolean>>({});

    const {config} = useScreeningConfig(projectId, phase);
    const {decisions, decide, isDeciding} = useScreeningDecisions(projectId, phase);
    const {progress} = useScreeningProgress(projectId, phase);

    // Load articles
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const {data, error} = await supabase
                .from('articles')
                .select('id, title, abstract, authors, publication_year, journal_title, doi, keywords')
                .eq('project_id', projectId)
                .order('created_at', {ascending: true});

            if (data) setArticles(data as Article[]);
            setLoading(false);
        };
        load();
    }, [projectId]);

    // Get articles that haven't been screened yet by current user
    const decidedArticleIds = useMemo(() => {
        return new Set(decisions.map(d => d.articleId));
    }, [decisions]);

    const pendingArticles = useMemo(() => {
        return articles.filter(a => !decidedArticleIds.has(a.id));
    }, [articles, decidedArticleIds]);

    const currentArticle = pendingArticles[currentIndex];

    const criteria: ScreeningCriterion[] = config?.criteria ?? [];

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
            if (!currentArticle || isDeciding) return;

            if (e.key === '1') handleDecision('include');
            else if (e.key === '2') handleDecision('exclude');
            else if (e.key === '3') handleDecision('maybe');
            else if (e.key === 'ArrowRight') goNext();
            else if (e.key === 'ArrowLeft') goPrev();
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    });

    const handleDecision = useCallback(async (decision: string) => {
        if (!currentArticle) return;
        try {
            await decide({
                articleId: currentArticle.id,
                decision,
                reason: reason.trim() || undefined,
                criteriaResponses,
            });
            setReason('');
            setCriteriaResponses({});
            toast.success(`Article ${decision === 'include' ? 'included' : decision === 'exclude' ? 'excluded' : 'marked as maybe'}`);
        } catch {
            toast.error('Error submitting decision');
        }
    }, [currentArticle, decide, reason, criteriaResponses]);

    const goNext = () => setCurrentIndex(i => Math.min(i + 1, pendingArticles.length - 1));
    const goPrev = () => setCurrentIndex(i => Math.max(i - 1, 0));

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/>
            </div>
        );
    }

    if (pendingArticles.length === 0) {
        return (
            <div className="text-center py-20">
                <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3"/>
                <p className="text-sm font-medium">All articles have been screened!</p>
                <p className="text-xs text-muted-foreground mt-1">
                    {articles.length} article(s) screened in {phase === 'title_abstract' ? 'title/abstract' : 'full-text'} phase.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Progress bar */}
            {progress && (
                <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{width: `${progress.totalArticles > 0 ? (progress.screened / progress.totalArticles) * 100 : 0}%`}}
                        />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                        {progress.screened}/{progress.totalArticles}
                    </span>
                </div>
            )}

            {/* Article card */}
            <div className="rounded-lg border border-border/50 bg-card">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border/30">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={goPrev} disabled={currentIndex === 0}>
                            <ChevronLeft className="h-4 w-4"/>
                        </Button>
                        <span className="text-xs text-muted-foreground">
                            {currentIndex + 1} of {pendingArticles.length} pending
                        </span>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={goNext} disabled={currentIndex >= pendingArticles.length - 1}>
                            <ChevronRight className="h-4 w-4"/>
                        </Button>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">1</kbd> Include
                        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">2</kbd> Exclude
                        <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">3</kbd> Maybe
                    </div>
                </div>

                {/* Content */}
                <ScrollArea className="max-h-[50vh]">
                    <div className="p-5 space-y-4">
                        {/* Title */}
                        <h3 className="text-base font-semibold leading-snug">
                            {currentArticle?.title || 'Untitled'}
                        </h3>

                        {/* Metadata badges */}
                        <div className="flex flex-wrap gap-1.5">
                            {currentArticle?.authors?.slice(0, 3).map((a, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px]">{a}</Badge>
                            ))}
                            {(currentArticle?.authors?.length ?? 0) > 3 && (
                                <Badge variant="secondary" className="text-[10px]">
                                    +{(currentArticle?.authors?.length ?? 0) - 3} more
                                </Badge>
                            )}
                            {currentArticle?.publication_year && (
                                <Badge variant="outline" className="text-[10px]">{currentArticle.publication_year}</Badge>
                            )}
                            {currentArticle?.journal_title && (
                                <Badge variant="outline" className="text-[10px]">{currentArticle.journal_title}</Badge>
                            )}
                        </div>

                        {/* Abstract */}
                        {currentArticle?.abstract && (
                            <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">Abstract</p>
                                <p className="text-sm leading-relaxed text-foreground/90">
                                    {currentArticle.abstract}
                                </p>
                            </div>
                        )}

                        {/* Keywords */}
                        {currentArticle?.keywords && currentArticle.keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {currentArticle.keywords.map((kw, i) => (
                                    <Badge key={i} variant="secondary" className="text-[10px] font-normal">{kw}</Badge>
                                ))}
                            </div>
                        )}
                    </div>
                </ScrollArea>

                {/* Criteria checklist */}
                {criteria.length > 0 && (
                    <div className="px-5 py-3 border-t border-border/30 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Criteria</p>
                        <div className="space-y-1.5">
                            {criteria.map(c => (
                                <label key={c.id} className="flex items-start gap-2 text-sm cursor-pointer">
                                    <Checkbox
                                        checked={criteriaResponses[c.id] ?? false}
                                        onCheckedChange={(checked) =>
                                            setCriteriaResponses(prev => ({...prev, [c.id]: !!checked}))
                                        }
                                        className="mt-0.5"
                                    />
                                    <span className={`flex-1 ${c.type === 'exclusion' ? 'text-red-600 dark:text-red-400' : ''}`}>
                                        <span className="text-[10px] font-semibold uppercase mr-1">
                                            [{c.type === 'inclusion' ? 'IN' : 'EX'}]
                                        </span>
                                        {c.label}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {/* Reason input */}
                <div className="px-5 py-3 border-t border-border/30">
                    <Textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason for decision (optional)"
                        rows={1}
                        className="text-sm resize-none"
                    />
                </div>

                {/* Decision buttons */}
                <div className="flex items-center gap-2 px-5 py-3 border-t border-border/30 bg-muted/20">
                    <Button
                        onClick={() => handleDecision('include')}
                        disabled={isDeciding}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    >
                        {isDeciding ? <Loader2 className="h-4 w-4 animate-spin mr-1"/> : <CheckCircle2 className="h-4 w-4 mr-1"/>}
                        Include
                    </Button>
                    <Button
                        onClick={() => handleDecision('exclude')}
                        disabled={isDeciding}
                        variant="destructive"
                        className="flex-1"
                    >
                        <XCircle className="h-4 w-4 mr-1"/>
                        Exclude
                    </Button>
                    <Button
                        onClick={() => handleDecision('maybe')}
                        disabled={isDeciding}
                        variant="outline"
                        className="flex-1"
                    >
                        <HelpCircle className="h-4 w-4 mr-1"/>
                        Maybe
                    </Button>
                </div>
            </div>
        </div>
    );
}
