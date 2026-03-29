/**
 * Screening dashboard with progress stats, PRISMA counts, and inter-rater metrics.
 */

import {Badge} from '@/components/ui/badge';
import {Loader2} from 'lucide-react';
import {useScreeningDashboard} from '@/hooks/screening/useScreeningProgress';

interface ScreeningDashboardProps {
    projectId: string;
    phase: 'title_abstract' | 'full_text';
}

export function ScreeningDashboard({projectId, phase}: ScreeningDashboardProps) {
    const {dashboard, isLoading} = useScreeningDashboard(projectId, phase);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/>
            </div>
        );
    }

    if (!dashboard) {
        return (
            <div className="text-center py-20 text-sm text-muted-foreground">
                No screening data yet. Configure criteria and start screening.
            </div>
        );
    }

    const progress = phase === 'title_abstract'
        ? dashboard.titleAbstractProgress
        : dashboard.fullTextProgress;

    const prisma = dashboard.prisma;
    const kappa = dashboard.cohensKappa;

    return (
        <div className="space-y-6">
            {/* Progress stats */}
            {progress && (
                <div>
                    <h3 className="text-sm font-medium mb-3">
                        {phase === 'title_abstract' ? 'Title/Abstract' : 'Full-Text'} Screening Progress
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                        {([
                            {label: 'Total', value: progress.totalArticles, color: 'text-foreground'},
                            {label: 'Screened', value: progress.screened, color: 'text-blue-600'},
                            {label: 'Pending', value: progress.pending, color: 'text-yellow-600'},
                            {label: 'Included', value: progress.included, color: 'text-green-600'},
                            {label: 'Excluded', value: progress.excluded, color: 'text-red-600'},
                            {label: 'Maybe', value: progress.maybe, color: 'text-orange-600'},
                            {label: 'Conflicts', value: progress.conflicts, color: 'text-purple-600'},
                        ]).map(({label, value, color}) => (
                            <div key={label} className="rounded-lg border border-border/40 p-3 text-center">
                                <p className={`text-2xl font-semibold ${color}`}>{value}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden flex">
                        {progress.totalArticles > 0 && (
                            <>
                                <div
                                    className="h-full bg-green-500 transition-all"
                                    style={{width: `${(progress.included / progress.totalArticles) * 100}%`}}
                                    title={`Included: ${progress.included}`}
                                />
                                <div
                                    className="h-full bg-red-500 transition-all"
                                    style={{width: `${(progress.excluded / progress.totalArticles) * 100}%`}}
                                    title={`Excluded: ${progress.excluded}`}
                                />
                                <div
                                    className="h-full bg-orange-400 transition-all"
                                    style={{width: `${(progress.maybe / progress.totalArticles) * 100}%`}}
                                    title={`Maybe: ${progress.maybe}`}
                                />
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Inter-rater reliability */}
            {kappa !== null && kappa !== undefined && (
                <div>
                    <h3 className="text-sm font-medium mb-3">Inter-Rater Reliability</h3>
                    <div className="rounded-lg border border-border/40 p-4 max-w-xs">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Cohen&apos;s Kappa</span>
                            <Badge variant={
                                kappa >= 0.8 ? 'default' :
                                kappa >= 0.6 ? 'secondary' :
                                'destructive'
                            }>
                                {kappa.toFixed(3)}
                            </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                            {kappa >= 0.8 ? 'Almost perfect agreement' :
                             kappa >= 0.6 ? 'Substantial agreement' :
                             kappa >= 0.4 ? 'Moderate agreement' :
                             kappa >= 0.2 ? 'Fair agreement' :
                             'Slight agreement'}
                        </p>
                    </div>
                </div>
            )}

            {/* PRISMA Flow */}
            <div>
                <h3 className="text-sm font-medium mb-3">PRISMA 2020 Flow</h3>
                <div className="space-y-2">
                    {/* Identification */}
                    <div className="rounded-lg border border-border/40 p-3">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Identification</p>
                        <p className="text-sm">Records identified: <span className="font-semibold">{prisma.totalImported}</span></p>
                        <p className="text-sm">Duplicates removed: <span className="font-semibold">{prisma.duplicatesRemoved}</span></p>
                    </div>

                    {/* Screening */}
                    <div className="rounded-lg border border-border/40 p-3">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Screening</p>
                        <p className="text-sm">Records screened: <span className="font-semibold">{prisma.titleAbstractScreened}</span></p>
                        <p className="text-sm">Records excluded: <span className="font-semibold text-red-600">{prisma.titleAbstractExcluded}</span></p>
                    </div>

                    {/* Eligibility */}
                    <div className="rounded-lg border border-border/40 p-3">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Eligibility</p>
                        <p className="text-sm">Full-text assessed: <span className="font-semibold">{prisma.fullTextAssessed}</span></p>
                        <p className="text-sm">Full-text excluded: <span className="font-semibold text-red-600">{prisma.fullTextExcluded}</span></p>
                    </div>

                    {/* Included */}
                    <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-3">
                        <p className="text-[10px] font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider mb-2">Included</p>
                        <p className="text-sm">Studies included: <span className="font-semibold text-green-700 dark:text-green-400">{prisma.included}</span></p>
                    </div>
                </div>
            </div>
        </div>
    );
}
