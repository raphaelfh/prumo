/**
 * Componente exibido quando nenhum instrumento de avaliacao esta configurado.
 *
 * Similar ao "Configure Template First" de extraction.
 * Orienta o usuario a configurar um instrumento antes de iniciar avaliacoes.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClipboardList, Settings, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
    <Card className="border-dashed border-2 border-muted-foreground/25">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <ClipboardList className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-xl">
          Configure o Instrumento de Avaliacao
        </CardTitle>
      </CardHeader>
      <CardContent className="text-center space-y-4">
        <p className="text-muted-foreground max-w-md mx-auto">
          Para iniciar a avaliacao de qualidade dos estudos, primeiro configure
          um instrumento de avaliacao para este projeto.
        </p>

        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Instrumentos disponiveis:
          </p>
          <div className="flex gap-2 flex-wrap justify-center">
            <span className="px-2 py-1 bg-primary/10 rounded text-sm font-medium">
              PROBAST
            </span>
            <span className="px-2 py-1 bg-muted rounded text-sm">ROBIS</span>
            <span className="px-2 py-1 bg-muted rounded text-sm">QUADAS-2</span>
            <span className="px-2 py-1 bg-muted rounded text-sm">ROB-2</span>
          </div>
        </div>

        <Button
          onClick={handleConfigureClick}
          size="lg"
          className="mt-4"
        >
          <Settings className="h-4 w-4 mr-2" />
          Configurar Instrumento
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
}

export default ConfigureInstrumentFirst;
