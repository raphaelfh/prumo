/**
 * EditArticle - Page to edit existing article
 * 
 * Usa o componente unificado ArticleForm em modo 'edit'
 */

import {Navigate, useNavigate, useParams} from "react-router-dom";
import {ArticleForm} from "@/components/articles/ArticleForm";

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
      // Navigate back to project article list
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
