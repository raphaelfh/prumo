/**
 * Header da interface de extração
 * 
 * Componente que mostra:
 * - Breadcrumb de navegação
 * - Indicador de auto-save
 * - Progress bar
 * - Botão voltar
 * 
 * @component
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { ArrowLeft, Loader2, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

// =================== INTERFACES ===================

interface ExtractionHeaderProps {
  projectId: string;
  projectName: string;
  articleTitle: string;
  isSaving?: boolean;
  lastSaved?: Date | null;
  onBack: () => void;
}

// =================== COMPONENT ===================

export function ExtractionHeader(props: ExtractionHeaderProps) {
  const navigate = useNavigate();
  const {
    projectId,
    projectName,
    articleTitle,
    completedFields,
    totalFields,
    completionPercentage,
    isSaving = false,
    lastSaved = null,
    onBack
  } = props;

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Linha 1: Voltar + Breadcrumb + Status */}
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Botão voltar */}
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          
          <Separator orientation="vertical" className="h-6" />
          
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  onClick={() => navigate(`/projects/${projectId}`)}
                  className="cursor-pointer hover:text-foreground"
                >
                  {projectName}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="max-w-[400px] truncate">
                  {articleTitle}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-save indicator */}
          {isSaving ? (
            <Badge variant="outline" className="gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Salvando...
            </Badge>
          ) : lastSaved ? (
            <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Salvo {formatDistanceToNow(lastSaved, { locale: ptBR, addSuffix: true })}
            </Badge>
          ) : null}
        </div>
      </div>

    </header>
  );
}

