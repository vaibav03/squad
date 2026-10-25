import { Link } from 'react-router-dom';
import { useAccount } from '../../auth/AuthProvider';
import { Icon } from '../../primitives/Icon';
import '../../auth/auth.css';

/** Two cards: start a squad or join one. Shown to a signed-in person with no squad yet. */
export function Choose() {
  const { user, logout } = useAccount();
  const first = user?.name.split(' ')[0] ?? '';
  return (
    <div className="sq-auth__step">
      <div className="sq-auth__head">
        <p className="sq-auth__tag">You are in</p>
        <h1 className="sq-auth__title" tabIndex={-1} data-autofocus>
          {first ? `Welcome, ${first}. Pick how to start.` : 'Pick how to start.'}
        </h1>
        <p className="sq-auth__lede">
          A squad is the small group you study with. You can be in more than one.
        </p>
      </div>
      <div className="sq-choose">
        <Link to="/squad/new" className="sq-choose__card">
          <span className="sq-choose__icon" aria-hidden="true">
            <Icon name="sparkle" size={22} />
          </span>
          <span>
            <span className="sq-choose__title">Create a squad</span>
            <span className="sq-choose__body">Name it, then invite classmates with a link.</span>
          </span>
          <Icon name="chevron-right" size={18} />
        </Link>
        <Link to="/join" className="sq-choose__card">
          <span className="sq-choose__icon" aria-hidden="true">
            <Icon name="link" size={22} />
          </span>
          <span>
            <span className="sq-choose__title">Join with a code</span>
            <span className="sq-choose__body">
              Got an invite link or an 8 character code? Start here.
            </span>
          </span>
          <Icon name="chevron-right" size={18} />
        </Link>
      </div>
      <button type="button" className="sq-auth__link" onClick={() => void logout()}>
        Not {first || 'you'}? Sign out
      </button>
    </div>
  );
}
