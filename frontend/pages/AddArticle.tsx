/**
 * AddArticle - Página para Adicionar Novo Artigo
 * 
 * Usa o componente unificado ArticleForm em modo 'add'
 */

import {Navigate, useParams} from "react-router-dom";
import {ArticleForm} from "@/components/articles/ArticleForm";

function AddArticle() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return <Navigate to="/" replace />;
  }

  return (
    <ArticleForm
      mode="add"
      projectId={projectId}
    />
  );
}

export default AddArticle;
