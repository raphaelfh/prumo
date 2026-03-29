/**
 * Legacy route: redirects to project articles tab with the add-article sheet open.
 */

import {Navigate, useParams} from "react-router-dom";

function AddArticle() {
    const {projectId} = useParams<{ projectId: string }>();

  if (!projectId) {
    return <Navigate to="/" replace />;
  }

    return <Navigate to={`/projects/${projectId}?tab=articles&articleEditor=add`} replace/>;
}

export default AddArticle;
