import { Navigate } from 'react-router-dom';

/**
 * Mastery lives in the village now (the Mastery board and the chapter houses). This route stays only so old links,
 * bookmarks and tests keep working: it sends you to the village with the in-world panel open.
 */
export default function MasteryRedirect() {
  return <Navigate to="/squad/village?mastery=1" replace />;
}
