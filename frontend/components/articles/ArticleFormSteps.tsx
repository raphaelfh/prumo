/**
 * ArticleFormSteps — the article editor's section rail.
 *
 * Presentational: it reports which step was chosen and knows nothing about
 * scrolling. `scrollToSection` stays with ArticleForm because handleSave calls
 * it too, to jump to whichever section failed validation.
 *
 * The IntersectionObserver that drives `activeStep` also stays in the parent: it
 * observes nodes the parent renders, and moving the subscription down here would
 * register it against a tree this component does not own.
 */

import {cn} from '@/lib/utils';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {AlertCircle} from 'lucide-react';
import {t} from '@/lib/copy';
import type {LucideIcon} from 'lucide-react';

export type FormStep = 'basic' | 'publication' | 'identifiers' | 'additional' | 'files';

export interface ArticleFormStep {
    id: FormStep;
    label: string;
    icon: LucideIcon;
    description: string;
}

interface ArticleFormStepsProps {
    steps: ArticleFormStep[];
    activeStep: FormStep;
    onSelect: (step: FormStep) => void;
    /** Flags the one step that can actually be invalid — the title lives there. */
    titleMissing: boolean;
}

export function ArticleFormSteps({steps, activeStep, onSelect, titleMissing}: ArticleFormStepsProps) {
    return (
        <aside
            className="w-full shrink-0 border-b border-border/40 bg-[#fafafa] dark:bg-[#0c0c0c] lg:w-56 lg:border-b-0 lg:border-r overflow-x-auto lg:overflow-y-auto">
            <nav
                role="navigation"
                aria-label={t('articles', 'formStepsAria')}
                className="flex flex-row gap-0.5 px-2 py-3 lg:flex-col lg:px-2 lg:py-4"
            >
                {steps.map((step) => {
                    const Icon = step.icon;
                    const isActive = step.id === activeStep;
                    return (
                        <Tooltip key={step.id}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-current={isActive ? 'location' : undefined}
                                    onClick={() => onSelect(step.id)}
                                    className={cn(
                                        'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors duration-75',
                                        'hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-1',
                                        'lg:w-full lg:shrink',
                                        isActive
                                            ? 'bg-muted text-foreground border-l-2 border-l-primary pl-1.5'
                                            : 'text-muted-foreground border-l-2 border-l-transparent pl-1.5'
                                    )}
                                >
                                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5}/>
                                    {/*
                                      * Below lg the rail is a horizontal strip and five full labels
                                      * overflow it — two steps sat off-screen behind a scrollbar. The
                                      * label folds to sr-only, never `hidden`: `hidden` would take it
                                      * out of the accessibility tree and the step would lose its
                                      * accessible name. A viewport breakpoint rather than the repo's
                                      * usual container query, because it has to fold at exactly the
                                      * lg where the rail stops being a column.
                                      */}
                                    <span
                                        data-slot="step-label"
                                        className="sr-only whitespace-nowrap lg:not-sr-only lg:whitespace-normal"
                                    >
                                        {step.label}
                                    </span>
                                    {isActive && step.id === 'basic' && titleMissing && (
                                        <AlertCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-warning"/>
                                    )}
                                </button>
                            </TooltipTrigger>
                            {/* Sighted mouse users at a narrow window; the fold covers screen readers. */}
                            <TooltipContent side="bottom" className="lg:hidden">
                                {step.label}
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </nav>
        </aside>
    );
}
