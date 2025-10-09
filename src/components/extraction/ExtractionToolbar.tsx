/**
 * Toolbar da interface de extração
 * 
 * Componente que controla:
 * - Toggle de PDF viewer
 * - Modo de visualização (Extract vs Compare)
 * - Botão de finalizar
 * 
 * @component
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Eye,
  EyeOff,
  FileText,
  Table,
  CheckCircle,
  Loader2,
  Sparkles
} from 'lucide-react';

// =================== INTERFACES ===================

interface ExtractionToolbarProps {
  showPDF: boolean;
  onTogglePDF: () => void;
  viewMode: 'extract' | 'compare';
  onViewModeChange: (mode: 'extract' | 'compare') => void;
  templateName: string;
  framework: string;
  completedFields: number;
  totalFields: number;
  completionPercentage: number;
  hasOtherExtractions: boolean;
  isComplete: boolean;
  onFinalize: () => void;
  submitting?: boolean;
}

// =================== COMPONENT ===================

export function ExtractionToolbar(props: ExtractionToolbarProps) {
  const {
    showPDF,
    onTogglePDF,
    viewMode,
    onViewModeChange,
    templateName,
    framework,
    completedFields,
    totalFields,
    completionPercentage,
    hasOtherExtractions,
    isComplete,
    onFinalize,
    submitting = false
  } = props;

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/10">
      {/* Esquerda: PDF controls + Progresso minimalista */}
      <div className="flex items-center gap-3">
        <Button
          variant={showPDF ? 'secondary' : 'outline'}
          size="sm"
          onClick={onTogglePDF}
        >
          {showPDF ? (
            <>
              <EyeOff className="mr-2 h-4 w-4" />
              Ocultar PDF
            </>
          ) : (
            <>
              <Eye className="mr-2 h-4 w-4" />
              Mostrar PDF
            </>
          )}
        </Button>
        
        <Separator orientation="vertical" className="h-6" />
        
        {/* Progresso minimalista */}
        <Badge variant="outline" className="gap-2 text-xs">
          <span className="text-muted-foreground">Progresso:</span>
          <span className="font-semibold tabular-nums">{completionPercentage}%</span>
          <span className="text-muted-foreground">({completedFields}/{totalFields})</span>
        </Badge>
      </div>

      {/* Centro: Template info + View mode */}
      <div className="flex items-center gap-4">
        <Badge variant="secondary" className="gap-1">
          <FileText className="h-3 w-3" />
          {templateName}
        </Badge>

        <Separator orientation="vertical" className="h-6" />

        <Tabs value={viewMode} onValueChange={(v) => onViewModeChange(v as any)}>
          <TabsList className="h-9">
            <TabsTrigger value="extract" className="text-xs">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Extração
            </TabsTrigger>
            <TabsTrigger 
              value="compare" 
              className="text-xs" 
              disabled={!hasOtherExtractions}
            >
              <Table className="mr-1.5 h-3.5 w-3.5" />
              Comparação
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Direita: Actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onFinalize}
          disabled={!isComplete || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Finalizando...
            </>
          ) : (
            <>
              <CheckCircle className="mr-2 h-4 w-4" />
              Finalizar Extração
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

