import { useNavigate } from 'react-router-dom';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import './connections.css';

/** Optional onboarding card: nothing is connected or requested from here. */
export function ConnectionsStepCard() {
  const navigate = useNavigate();
  return (
    <Card className="sq-conn__card" aria-label="Optional: connect Canvas and Google">
      <strong>Optional: bring in Canvas and Google</strong>
      <p className="sq-conn__meta">
        Read-only, private to you until you share, and deleted when you disconnect. You can skip
        this.
      </p>
      <Button variant="secondary" size="sm" onClick={() => navigate('/squad/connections')}>
        Open connections
      </Button>
    </Card>
  );
}
