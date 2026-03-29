/**
 * Screening configuration editor.
 *
 * Manage inclusion/exclusion criteria, dual review, blind mode, and AI settings.
 */

import {useCallback, useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';
import {Badge} from '@/components/ui/badge';
import {Loader2, Plus, Trash2} from 'lucide-react';
import {toast} from 'sonner';
import {useScreeningConfig} from '@/hooks/screening/useScreeningConfig';
import type {ScreeningCriterion} from '@/types/screening';

interface ScreeningConfigEditorProps {
    projectId: string;
    phase: 'title_abstract' | 'full_text';
}

export function ScreeningConfigEditor({projectId, phase}: ScreeningConfigEditorProps) {
    const {config, isLoading, updateConfig, isUpdating} = useScreeningConfig(projectId, phase);

    const [criteria, setCriteria] = useState<ScreeningCriterion[]>([]);
    const [dualReview, setDualReview] = useState(false);
    const [blindMode, setBlindMode] = useState(false);
    const [aiModel, setAiModel] = useState('gpt-4o-mini');
    const [aiInstruction, setAiInstruction] = useState('');

    // Populate from config
    useEffect(() => {
        if (config) {
            setCriteria(config.criteria || []);
            setDualReview(config.requireDualReview);
            setBlindMode(config.blindMode);
            setAiModel(config.aiModelName || 'gpt-4o-mini');
            setAiInstruction(config.aiSystemInstruction || '');
        }
    }, [config]);

    const addCriterion = (type: 'inclusion' | 'exclusion') => {
        setCriteria(prev => [
            ...prev,
            {id: crypto.randomUUID(), type, label: '', description: ''},
        ]);
    };

    const updateCriterion = (id: string, field: string, value: string) => {
        setCriteria(prev =>
            prev.map(c => c.id === id ? {...c, [field]: value} : c)
        );
    };

    const removeCriterion = (id: string) => {
        setCriteria(prev => prev.filter(c => c.id !== id));
    };

    const handleSave = useCallback(async () => {
        try {
            await updateConfig({
                requireDualReview: dualReview,
                blindMode: blindMode,
                criteria: criteria.filter(c => c.label.trim()),
                aiModelName: aiModel,
                aiSystemInstruction: aiInstruction.trim() || undefined,
            });
            toast.success('Configuration saved');
        } catch {
            toast.error('Error saving configuration');
        }
    }, [updateConfig, dualReview, blindMode, criteria, aiModel, aiInstruction]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-2xl">
            {/* Review settings */}
            <div className="space-y-4">
                <h3 className="text-sm font-medium">Review settings</h3>

                <div className="flex items-center justify-between rounded-lg border border-border/40 p-3">
                    <div>
                        <p className="text-sm font-medium">Dual review</p>
                        <p className="text-xs text-muted-foreground">Require two independent reviewers per article</p>
                    </div>
                    <Switch checked={dualReview} onCheckedChange={setDualReview}/>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border/40 p-3">
                    <div>
                        <p className="text-sm font-medium">Blind mode</p>
                        <p className="text-xs text-muted-foreground">Hide other reviewers&apos; decisions until both have screened</p>
                    </div>
                    <Switch checked={blindMode} onCheckedChange={setBlindMode}/>
                </div>
            </div>

            {/* Criteria */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Screening criteria</h3>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => addCriterion('inclusion')}
                        >
                            <Plus className="h-3 w-3 mr-1"/>
                            Inclusion
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => addCriterion('exclusion')}
                        >
                            <Plus className="h-3 w-3 mr-1"/>
                            Exclusion
                        </Button>
                    </div>
                </div>

                {criteria.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border/50 rounded-lg">
                        No criteria defined. Add inclusion or exclusion criteria to guide screening.
                    </p>
                )}

                <div className="space-y-2">
                    {criteria.map(c => (
                        <div key={c.id} className="flex items-start gap-2 rounded-lg border border-border/40 p-3">
                            <Badge
                                variant={c.type === 'inclusion' ? 'default' : 'destructive'}
                                className="mt-0.5 text-[10px] shrink-0"
                            >
                                {c.type === 'inclusion' ? 'IN' : 'EX'}
                            </Badge>
                            <div className="flex-1 space-y-1.5">
                                <Input
                                    value={c.label}
                                    onChange={(e) => updateCriterion(c.id, 'label', e.target.value)}
                                    placeholder="Criterion label"
                                    className="h-7 text-sm"
                                />
                                <Input
                                    value={c.description || ''}
                                    onChange={(e) => updateCriterion(c.id, 'description', e.target.value)}
                                    placeholder="Description (optional)"
                                    className="h-7 text-xs"
                                />
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeCriterion(c.id)}
                            >
                                <Trash2 className="h-3.5 w-3.5"/>
                            </Button>
                        </div>
                    ))}
                </div>
            </div>

            {/* AI settings */}
            <div className="space-y-4">
                <h3 className="text-sm font-medium">AI screening settings</h3>

                <div>
                    <Label className="text-xs">Model</Label>
                    <Input
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="h-8 text-sm mt-1"
                    />
                </div>

                <div>
                    <Label className="text-xs">Custom system instruction (optional)</Label>
                    <Textarea
                        value={aiInstruction}
                        onChange={(e) => setAiInstruction(e.target.value)}
                        placeholder="Additional instructions for the AI screening model..."
                        rows={3}
                        className="text-sm mt-1"
                    />
                </div>
            </div>

            {/* Save button */}
            <div className="flex justify-end pt-2">
                <Button onClick={handleSave} disabled={isUpdating}>
                    {isUpdating ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin mr-1"/>
                            Saving...
                        </>
                    ) : 'Save configuration'}
                </Button>
            </div>
        </div>
    );
}
