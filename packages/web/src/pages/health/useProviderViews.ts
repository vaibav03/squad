import { useEffect, useState } from 'react';
import { useSquadConfig } from '../../shell/context';
import { hub } from '../connections/api';
import { deriveProviderState, type ProviderView } from '../connections/connection-state';

/** The per-provider state-machine views for the signed-in viewer (null until the hub answered). */
export function useProviderViews(reloadKey: unknown = 0): { canvas: ProviderView; google: ProviderView } | null {
  const cfg = useSquadConfig();
  const [v, setV] = useState<{ canvas: ProviderView; google: ProviderView } | null>(null);
  useEffect(() => {
    if (!(cfg.mode === 'live' && cfg.hubUrl && cfg.token)) return;
    let dead = false;
    void hub({ hubUrl: cfg.hubUrl.replace(/\/+$/, ''), token: cfg.token })
      .list()
      .then((all) => {
        if (dead) return;
        const now = Date.now();
        setV({
          canvas: deriveProviderState('canvas', all.filter((c) => c.provider === 'canvas'), { now }),
          google: deriveProviderState('google', all.filter((c) => c.provider === 'google'), { now }),
        });
      }, () => !dead && setV(null));
    return () => {
      dead = true;
    };
  }, [cfg.mode, cfg.hubUrl, cfg.token, reloadKey]);
  return v;
}
