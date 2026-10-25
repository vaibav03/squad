import { Notice } from '../../primitives/Notice';

/** `GET /v1/imessage/setup`: names and URLs only, never a value of a credential. */
export interface SendblueSetupInfo {
  provider: 'off' | 'fake' | 'local' | 'sendblue';
  missingEnv: string[];
  webhookUrl: string;
  statusUrl: string;
  secretHeader: string;
  safety?: {
    dryRun: boolean;
    killSwitch: boolean;
    allowlist: { chats: number; handles: number; allowAll: boolean };
  };
}

const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(u);

/** The Sendblue part of the iMessage card: exact missing env names, the webhook URL to paste, allowlist steps. */
export function SendblueSetup({ info }: { info: SendblueSetupInfo }) {
  return (
    <section data-testid="connections-sendblue" aria-label="Sendblue setup">
      <h4 className="sq-conn__h3">Sendblue (hosted iMessage)</h4>
      {info.missingEnv.length ? (
        <Notice tone="warn" title="Sendblue is not configured">
          Set these in the hub environment, then restart it:{' '}
          <span data-testid="connections-sendblue-missing">
            {info.missingEnv.map((n, i) => (
              <span key={n}>
                {i ? ', ' : ''}
                <code>{n}</code>
              </span>
            ))}
          </span>
        </Notice>
      ) : (
        <p className="sq-conn__meta">
          All four <code>SENDBLUE_*</code> values are set
          {info.provider === 'sendblue' ? '.' : ' but IMESSAGE_PROVIDER is not sendblue.'}
        </p>
      )}
      {info.safety ? (
        <ul
          className="sq-conn__scopes"
          data-testid="connections-sendblue-safety"
          aria-label="Sendblue safety flags"
        >
          <li data-testid="sb-kill-switch">
            Kill switch:{' '}
            {info.safety.killSwitch ? 'ON (nothing is read or sent)' : 'off (IMESSAGE_ENABLED=1)'}
          </li>
          <li data-testid="sb-dry-run">
            Dry run: {info.safety.dryRun ? 'ON (nothing is sent)' : 'off'}
          </li>
          <li data-testid="sb-allowlist">
            Allowlist: {info.safety.allowlist.chats} chat(s), {info.safety.allowlist.handles}{' '}
            number(s)
            {info.safety.allowlist.allowAll ? ', ALLOW-ALL IS ON' : ''}
            {!info.safety.allowlist.allowAll &&
            info.safety.allowlist.chats + info.safety.allowlist.handles === 0
              ? ' (none: nothing is sent)'
              : ''}
          </li>
        </ul>
      ) : null}
      <ol className="sq-conn__scopes" data-testid="connections-sendblue-steps">
        <li>
          Set <code>IMESSAGE_PROVIDER=sendblue</code> and <code>IMESSAGE_ENABLED=1</code>.
        </li>
        <li>
          In the Sendblue dashboard (Developer, Webhooks) add a <code>receive</code> webhook with
          this URL and a secret that equals <code>SENDBLUE_WEBHOOK_SECRET</code> (it arrives in the{' '}
          <code>{info.secretHeader}</code> header):{' '}
          <code data-testid="connections-sendblue-webhook">{info.webhookUrl}</code>
        </li>
        <li>
          Add the <code>outbound</code> webhook (or rely on the per-message status callback) so
          delivery and read states update: <code>{info.statusUrl}</code>
        </li>
        <li>
          Allowlist (required: with none, nothing is sent):{' '}
          <code>IMESSAGE_ALLOWED_CHATS=Sendblue;+;&lt;group_id&gt;</code> and{' '}
          <code>IMESSAGE_ALLOWED_HANDLES=&lt;your own number&gt;</code>. Start with{' '}
          <code>IMESSAGE_DRY_RUN=1</code>.
        </li>
        <li>
          In the iMessage group send <code>join &lt;invite code&gt;</code>; then{' '}
          <code>@squad</code> messages appear in the same Squad thread.
        </li>
      </ol>
      {isLocal(info.webhookUrl) ? (
        <p className="sq-conn__meta" data-testid="connections-sendblue-tunnel">
          This URL is local, so Sendblue cannot reach it. For local development run a tunnel (for
          example <code>cloudflared tunnel --url http://localhost:8788</code>) and set{' '}
          <code>SENDBLUE_PUBLIC_URL</code> to the https address it prints.
        </p>
      ) : null}
      <p className="sq-conn__meta">
        Details and the safe real-account smoke are in <code>docs/sendblue.md</code>.
      </p>
    </section>
  );
}
