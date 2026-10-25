import { useMemo, type ReactNode } from 'react';
import type { GalleryStory } from '../../overlays/kit';
import { ChatDock } from './ChatDock';
import { ChatView } from './ChatView';
import { DM_ID, GROUP_ID, ME, createFakeChatApi, type FakeChatOptions } from './fixtures';
import { useChat } from './useChat';

function FakeChat({ opts, active }: { opts?: FakeChatOptions; active?: string }) {
  const api = useMemo(() => createFakeChatApi({ ...opts, now: Date.now() }), [opts]);
  const ctl = useChat(api, { me: ME });
  return (
    <div
      style={{
        maxWidth: 1100,
        height: 640,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ChatView ctl={ctl} activeId={active ?? GROUP_ID} onActiveChange={() => {}} />
    </div>
  );
}

function FakeWorld({ children }: { children: ReactNode }) {
  return (
    <div
      className="sq-scene"
      style={{
        position: 'relative',
        height: 620,
        overflow: 'hidden',
        borderRadius: 12,
        background:
          'linear-gradient(180deg, var(--sq-sky-deep) 0%, var(--sq-sky-mid) 55%, var(--sq-sky-low) 78%, var(--sq-hill-mid) 78%, var(--sq-hill-near) 90%, var(--sq-ground) 90%)',
      }}
    >
      {children}
    </div>
  );
}

function Dock() {
  const api = useMemo(() => createFakeChatApi({ now: Date.now() }), []);
  return (
    <FakeWorld>
      <ChatDock enabled api={api} me={ME} />
    </FakeWorld>
  );
}

export const stories: GalleryStory[] = [
  { id: 'chat-group', title: 'Chat: squad group', render: () => <FakeChat /> },
  { id: 'chat-dm', title: 'Chat: private DM', render: () => <FakeChat active={DM_ID} /> },
  {
    id: 'chat-empty',
    title: 'Chat: empty thread',
    render: () => <FakeChat opts={{ empty: true }} />,
  },
  {
    id: 'chat-live',
    title: 'Chat: live model (no demo notice)',
    render: () => <FakeChat opts={{ demo: false }} />,
  },
  { id: 'chat-dock', title: 'Chat: village dock', render: () => <Dock /> },
];
