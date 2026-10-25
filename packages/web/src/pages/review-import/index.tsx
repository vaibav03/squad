import { useEffect } from 'react';
import { Page } from '../../primitives/Page';
import { useShell } from '../../shell/shell-context';
import { ReviewImport } from '../connections/ReviewImport';

/** /squad/connections/review: check what was imported before sharing anything. */
export default function ReviewImportRoute() {
  const { setTitle } = useShell();
  useEffect(() => setTitle('Review imported context'), [setTitle]);
  return (
    <Page title="Review imported context">
      <ReviewImport />
    </Page>
  );
}
