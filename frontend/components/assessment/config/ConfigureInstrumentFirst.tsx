/**
 * Shown when no assessment instrument is configured.
 * Similar to Configure Template First in extraction.
 * Guides the user to configure an instrument before starting assessments.
 */

import React from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {ArrowRight, ClipboardList, Settings} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {t} from '@/lib/copy';

interface ConfigureInstrumentFirstProps {
  projectId: string;
  onConfigureClick?: () => void;
}

export function ConfigureInstrumentFirst({
  projectId,
  onConfigureClick,
}: ConfigureInstrumentFirstProps) {
  const navigate = useNavigate();

  const handleConfigureClick = () => {
    if (onConfigureClick) {
      onConfigureClick();
    } else {
      // Navigate to project settings assessment tab
      navigate(`/projects/${projectId}/settings?tab=assessment`);
    }
  };

  return (
      <Card className="border border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-md">
          <CardHeader className="text-center pb-2 pt-6">
              <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <ClipboardList className="h-4 w-4 text-primary" strokeWidth={1.5}/>
        </div>
              <CardTitle className="text-base font-medium">
                  {t('assessment', 'configInstrumentFirstTitle')}
        </CardTitle>
      </CardHeader>
          <CardContent className="text-center space-y-3 pb-6">
              <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
                  {t('assessment', 'configInstrumentFirstDesc')}
        </p>

        <div className="flex flex-col items-center gap-2">
            <p className="text-[13px] text-muted-foreground">
                {t('assessment', 'configInstrumentsAvailable')}
          </p>
          <div className="flex gap-2 flex-wrap justify-center">
            <span className="px-2 py-1 bg-primary/10 rounded text-[13px] font-medium">
              PROBAST
            </span>
              <span className="px-2 py-1 bg-muted rounded text-[13px]">ROBIS</span>
              <span className="px-2 py-1 bg-muted rounded text-[13px]">QUADAS-2</span>
              <span className="px-2 py-1 bg-muted rounded text-[13px]">ROB-2</span>
          </div>
        </div>

        <Button
          onClick={handleConfigureClick}
          size="default"
          className="mt-2"
        >
            <Settings className="h-4 w-4 mr-2" strokeWidth={1.5}/>
            {t('assessment', 'configInstrumentButton')}
            <ArrowRight className="h-4 w-4 ml-2" strokeWidth={1.5}/>
        </Button>
      </CardContent>
    </Card>
  );
}

export default ConfigureInstrumentFirst;
