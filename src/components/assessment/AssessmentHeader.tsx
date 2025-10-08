import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useProject } from '@/contexts/ProjectContext';

interface AssessmentHeaderProps {
  projectName?: string;
  articleTitle?: string;
}

export function AssessmentHeader({ projectName, articleTitle }: AssessmentHeaderProps) {
  const navigate = useNavigate();
  const { project } = useProject();

  const handleBackToProjects = () => {
    navigate('/projects');
  };

  const handleBackToProject = () => {
    if (project?.id) {
      navigate(`/projects/${project.id}`);
    }
  };

  return (
    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center">
        <div className="flex items-center space-x-2">
          {/* Botão Voltar */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToProjects}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </Button>

          {/* Separador */}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />

          {/* Breadcrumb Projetos */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToProjects}
            className="text-muted-foreground hover:text-foreground"
          >
            Projetos
          </Button>

          {/* Separador */}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />

          {/* Breadcrumb Projeto */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToProject}
            className="text-muted-foreground hover:text-foreground"
          >
            {projectName || project?.name || 'Projeto'}
          </Button>

          {/* Separador */}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />

          {/* Breadcrumb Atual - Avaliação */}
          <span className="text-sm font-medium text-foreground">
            Avaliação
          </span>

          {/* Título do artigo se disponível */}
          {articleTitle && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground truncate max-w-[300px]">
                {articleTitle}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}