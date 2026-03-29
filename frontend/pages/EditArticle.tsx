/**
 * Legacy route: redirects to project articles tab with the edit-article sheet open.
 */

import {Navigate, useParams} from "react-router-dom";

function EditArticle() {
    const {projectId, articleId} = useParams<{
        projectId: string;
        articleId: string;
  }>();

  if (!projectId || !articleId) {
    return <Navigate to="/" replace />;
  }

    const search = new URLSearchParams({
        tab: 'articles',
        articleEditor: 'edit',
        articleId,
    });

    return <Navigate to={`/projects/${projectId}?${search.toString()}`} replace/>;
}

export default EditArticle;
