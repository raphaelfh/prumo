/**
 * EditArticle - Página para Editar Artigo Existente
 * 
 * Usa o componente unificado ArticleForm em modo 'edit'
 */

import { useParams, Navigate, useNavigate } from "react-router-dom";
import { ArticleForm } from "@/components/articles/ArticleForm";

function EditArticle() {
  const { projectId, articleId } = useParams<{ 
    projectId: string; 
    articleId: string; 
  }>();
  const navigate = useNavigate();

  if (!projectId || !articleId) {
    return <Navigate to="/" replace />;
  }

  const handleComplete = () => {
    // Navegar de volta para a lista de artigos do projeto
    navigate(`/projects/${projectId}?tab=articles`);
  };

  return (
    <ArticleForm
      mode="edit"
      projectId={projectId}
      articleId={articleId}
      onComplete={handleComplete}
    />
  );
}

export default EditArticle;
