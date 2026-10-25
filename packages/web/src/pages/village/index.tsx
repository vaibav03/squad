import { useEffect, useRef, useState } from 'react';
import { mountVillage } from '@squad/village';
import type { OverlayEvent, VillageHandle } from '@squad/village';
import { loadReplay, type ReplaySource } from '@squad/village/sources';
import { useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';

/**
 * INTEGRATION GLUE (integration/preview): mounts the Phaser village in the shell and feeds it a hub
 * replay (`?replay=track2`). Overlays are only logged on screen; the real overlay wiring (CallPanel,
 * QuizCard, ConfirmSheet) is not done yet.
 */
export default function VillagePage() {
  const host = useRef<HTMLDivElement>(null);
  const cfg = useSquadConfig();
  const { setTitle } = useShell();
  const [msg, setMsg] = useState('Loading');
  const [overlay, setOverlay] = useState<string | null>(null);
  const replayName = new URLSearchParams(location.search).get('replay');

  useEffect(() => setTitle('Village'), [setTitle]);

  useEffect(() => {
    let handle: VillageHandle | undefined;
    let src: ReplaySource | undefined;
    let dead = false;
    void (async () => {
      try {
        if (!replayName || !cfg.hubUrl) {
          setMsg(
            replayName
              ? 'No hub URL (set VITE_HUB_URL)'
              : 'Open /squad/village?replay=track2 with VITE_HUB_URL set',
          );
          return;
        }
        src = await loadReplay(replayName, {
          baseUrl: cfg.hubUrl.replace(/\/+$/, ''),
          opts: { autoplay: true },
        });
        if (dead) {
          src.close();
          return;
        }
        handle = mountVillage({
          parent: host.current!,
          source: src,
          me: src.cast.me,
          onOverlay: (o: OverlayEvent) => setOverlay(JSON.stringify(o)),
        });
        (window as unknown as Record<string, unknown>).__village = handle;
        (window as unknown as Record<string, unknown>).__replay = src;
        await handle.ready;
        setMsg('');
      } catch (e) {
        setMsg(`Village failed: ${(e as Error).message}`);
      }
    })();
    return () => {
      dead = true;
      src?.close();
      handle?.destroy();
    };
  }, [cfg.hubUrl, replayName]);

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100dvh - 56px)' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {msg && (
        <p style={{ position: 'absolute', top: 8, left: 8, color: '#fff', zIndex: 5 }}>{msg}</p>
      )}
      {replayName && (
        <span
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 5,
            padding: '2px 8px',
            background: '#000a',
            color: '#ffd166',
            font: '12px monospace',
          }}
        >
          Replay: {replayName}
        </span>
      )}
      {overlay && (
        <code
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            zIndex: 5,
            padding: 4,
            background: '#000a',
            color: '#9fe',
            font: '11px monospace',
          }}
        >
          overlay: {overlay}
        </code>
      )}
    </div>
  );
}
