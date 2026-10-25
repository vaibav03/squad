import { Navigate } from 'react-router-dom';

/**
 * The ledger is no longer a standalone area: it is a drawer inside the group chat. This route stays only so old
 * links and bookmarks keep working: it sends you to your group chat with the ledger open and a short notice.
 */
export default function LedgerRedirect() {
  return <Navigate to="/squad/chat?view=ledger&notice=ledger-moved" replace />;
}
