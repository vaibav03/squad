import { useEffect, type ReactNode } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAccount } from '../../auth/AuthProvider';
import { AuthStage } from '../../auth/AuthStage';
import { recallNext, rememberNext, safeNext } from '../../auth/storage';
import { OfflineState, RateLimitedState } from '../../primitives/EmptyState';
import { Skeleton } from '../../primitives/Skeleton';
import { Choose } from './Choose';
import { WelcomeFlow } from './WelcomeFlow';

function Go({ to }: { to: string }) {
  useEffect(() => () => rememberNext(null), []);
  return <Navigate to={to} replace />;
}

function Pending() {
  return (
    <div className="sq-auth__form" aria-busy="true" aria-label="Loading">
      <Skeleton width={96} height={8} />
      <Skeleton height={28} />
      <Skeleton height={48} />
      <Skeleton height={48} />
    </div>
  );
}

/** Public: sign up or sign in with a name, a phone or email, and a 6 digit code. */
export default function WelcomePage() {
  const { step } = useParams();
  const [params] = useSearchParams();
  const account = useAccount();
  const asked = safeNext(params.get('next'));
  const next = asked ?? recallNext();

  useEffect(() => {
    document.title = 'Welcome · Squad';
    if (asked) rememberNext(asked);
  }, [asked]);

  const home = next ?? (account.squads.length > 0 ? '/squad' : '/welcome/choose');
  let body: ReactNode;
  if (account.status === 'loading') body = <Pending />;
  else if (account.status === 'rate-limited' && account.user === null)
    body = (
      <RateLimitedState
        retryAt={account.retryAt}
        onRetry={() => void account.refresh().catch(() => {})}
      />
    );
  else if (account.status === 'offline' && account.user === null)
    body = <OfflineState onRetry={() => void account.refresh().catch(() => {})} />;
  else if (
    account.status === 'signed-in' ||
    account.status === 'offline' ||
    account.status === 'rate-limited'
  ) {
    if (step === 'choose') body = <Choose />;
    else return <Go to={home} />;
  } else if (step === 'choose') return <Navigate to="/welcome" replace />;
  else body = <WelcomeFlow devHref={account.devLogin ? '/signin' : null} />;

  return <AuthStage label="Welcome to Squad">{body}</AuthStage>;
}
