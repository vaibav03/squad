import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createChatApi, type ChatApi } from './api';
import { ME, fixtureApiFor } from './fixtures';
import { ChatView } from './ChatView';
import { SourceViewerHost } from '../../components/source-viewer';
import { useChat } from './useChat';
import { hubStudentId } from '../../shell/dev-login';
import { useSquadConfig, useAuth } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { ContextGateFrame } from './ContextGate';
import { LedgerDrawer, createGroupLedgerFetcher, useLedgerDrawer } from './ledger';
import { fixtureLedger } from './ledger/fixtures';

/** `/squad/chat`: the squad group chat and your private chat with Nook. Live over SSE; `?c=<chatId>` deep-links a chat. */
export default function ChatPage() {
  const cfg = useSquadConfig();
  const { signOut } = useAuth();
  const { setTitle } = useShell();
  const [params, setParams] = useSearchParams();
  useEffect(() => setTitle('Chat'), [setTitle]);

  const fixtures = import.meta.env.DEV && params.get('demo') === 'fixtures';
  const fx = fixtures ? params.get('fx') : null;
  const live = cfg.mode === 'live' && !!cfg.hubUrl && !!cfg.token;
  const api = useMemo<ChatApi | null>(
    () =>
      fixtures
        ? fixtureApiFor(fx)
        : live
          ? createChatApi({ hubUrl: cfg.hubUrl!, token: cfg.token! })
          : null,
    [fixtures, fx, live, cfg.hubUrl, cfg.token],
  );
  const me = fixtures ? ME : cfg.userId ? hubStudentId(cfg.userId) : '';
  const ctl = useChat(api, { me });

  const active = params.get('c') ?? params.get('group');
  const setActive = useCallback(
    (id: string | null) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.delete('group');
          if (id) n.set('c', id);
          else n.delete('c');
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  const ledger = useLedgerDrawer();
  const groupId = params.get('group') ?? ctl.chats.find((c) => c.kind === 'group')?.id ?? null;
  const fetchLedger = useMemo(
    () =>
      fixtures
        ? () => Promise.resolve(fixtureLedger)
        : live
          ? createGroupLedgerFetcher({ hubUrl: cfg.hubUrl!, token: cfg.token! })
          : null,
    [fixtures, live, cfg.hubUrl, cfg.token],
  );
  const moved = params.get('notice') === 'ledger-moved';
  return (
    <ContextGateFrame>
      <div className="sqld-layout">
        <div className="sqld-main">
          <ChatView
            ctl={ctl}
            activeId={active}
            onActiveChange={setActive}
            onSignInAgain={signOut}
            onOpenLedger={ledger.open}
          />
        </div>
        {ledger.isOpen && groupId ? (
          <LedgerDrawer
            groupId={groupId}
            fetchLedger={fetchLedger}
            onClose={ledger.close}
            notice={moved ? 'The ledger now lives inside each group chat.' : undefined}
          />
        ) : null}
      </div>
      <SourceViewerHost />
    </ContextGateFrame>
  );
}
