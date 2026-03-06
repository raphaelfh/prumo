/**
 * Component shown when no extraction template is configured.
 * Mirrors ConfigureInstrumentFirst (Assessment). Guides the user to configure
 * a template before starting extractions.
 */

import React from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {ArrowRight, Download, FileStack, PlusCircle, Settings} from 'lucide-react';
import {t} from '@/lib/copy';

interface ConfigureTemplateFirstProps {
    onConfigureClick?: () => void;
}

export function ConfigureTemplateFirst({
                                           onConfigureClick,
                                       }: ConfigureTemplateFirstProps) {
    const handleConfigureClick = () => {
        onConfigureClick?.();
    };

    return (
        <Card className="border border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-md">
            <CardHeader className="text-center pb-2 pt-6">
                <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <FileStack className="h-4 w-4 text-primary" strokeWidth={1.5}/>
                </div>
                <CardTitle className="text-base font-medium">
                    {t('extraction', 'configTemplateFirstTitle')}
                </CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-3 pb-6">
                <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
                    {t('extraction', 'configTemplateFirstDesc')}
                </p>

                <div className="flex flex-col items-center gap-2">
                    <div className="bg-muted/50 rounded-lg p-3 w-full max-w-md space-y-2 text-left">
                        <div className="flex items-start space-x-2">
                            <Download className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" strokeWidth={1.5}/>
                            <div>
                                <p className="text-[13px] font-medium">{t('extraction', 'configImportCharms')}</p>
                                <p className="text-[13px] text-muted-foreground">
                                    {t('extraction', 'configImportCharmsDesc')}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start space-x-2">
                            <PlusCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0"
                                        strokeWidth={1.5}/>
                            <div>
                                <p className="text-[13px] font-medium">{t('extraction', 'configCreateCustom')}</p>
                                <p className="text-[13px] text-muted-foreground">
                                    {t('extraction', 'configCreateCustomDesc')}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <Button
                    onClick={handleConfigureClick}
                    size="default"
                    className="mt-2"
                >
                    <Settings className="h-4 w-4 mr-2" strokeWidth={1.5}/>
                    {t('extraction', 'configGoToConfig')}
                    <ArrowRight className="h-4 w-4 ml-2" strokeWidth={1.5}/>
                </Button>
            </CardContent>
        </Card>
    );
}

export default ConfigureTemplateFirst;
