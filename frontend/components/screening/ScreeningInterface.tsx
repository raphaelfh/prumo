/**
 * Main screening interface with tabs: Screening / Dashboard / Configuration.
 * Follows AssessmentInterface.tsx pattern.
 */

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {ScreeningCardView} from './ScreeningCardView';
import {ScreeningDashboard} from './dashboard/ScreeningDashboard';
import {ScreeningConfigEditor} from './config/ScreeningConfigEditor';

interface ScreeningInterfaceProps {
    projectId: string;
}

type ScreeningTab = 'screening' | 'dashboard' | 'configuration';

export function ScreeningInterface({projectId}: ScreeningInterfaceProps) {
    const [activeTab, setActiveTab] = useState<ScreeningTab>('screening');
    const [phase, setPhase] = useState<'title_abstract' | 'full_text'>('title_abstract');

    return (
        <div className="space-y-4">
            {/* Phase selector */}
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-0.5">
                    <Button
                        variant="ghost"
                        size="sm"
                        className={`h-7 px-3 text-xs font-medium rounded-md transition-colors ${
                            phase === 'title_abstract'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setPhase('title_abstract')}
                    >
                        Title / Abstract
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className={`h-7 px-3 text-xs font-medium rounded-md transition-colors ${
                            phase === 'full_text'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setPhase('full_text')}
                    >
                        Full Text
                    </Button>
                </div>

                <div className="flex-1"/>

                {/* Tab navigation */}
                <div className="flex items-center gap-0.5">
                    {([
                        {value: 'screening' as const, label: 'Screening'},
                        {value: 'dashboard' as const, label: 'Dashboard'},
                        {value: 'configuration' as const, label: 'Configuration'},
                    ]).map(({value, label}) => (
                        <Button
                            key={value}
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 text-xs font-medium rounded-md transition-colors ${
                                activeTab === value
                                    ? 'bg-muted/50 text-foreground'
                                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            }`}
                            onClick={() => setActiveTab(value)}
                        >
                            {label}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Tab content */}
            {activeTab === 'screening' && (
                <ScreeningCardView projectId={projectId} phase={phase}/>
            )}
            {activeTab === 'dashboard' && (
                <ScreeningDashboard projectId={projectId} phase={phase}/>
            )}
            {activeTab === 'configuration' && (
                <ScreeningConfigEditor projectId={projectId} phase={phase}/>
            )}
        </div>
    );
}
