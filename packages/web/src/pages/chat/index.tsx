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

/** `/squad/chat`: the squad group chat and your private chat with Cubbie. Live over SSE; `?c=<chatId>` deep-links a chat. */
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

  // `?open=group` (the first-run tour) opens the squad's group chat directly, also on a phone where the list shows first
  const active =
    params.get('c') ??
    (params.get('open') === 'group'
      ? (ctl.chats.find((c) => c.kind === 'group')?.id ?? null)
      : null);
  const setActive = useCallback(
    (id: string | null) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (id) n.set('c', id);
          else n.delete('c');
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  return (
    <ContextGateFrame>
      <ChatView ctl={ctl} activeId={active} onActiveChange={setActive} onSignInAgain={signOut} />
      <SourceViewerHost />
    </ContextGateFrame>
  );
}
