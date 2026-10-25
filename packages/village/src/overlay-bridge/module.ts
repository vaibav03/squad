import type { SceneModule, VillageBusEvents } from '../world/api';
import { createOverlayBridge } from './bridge';
import type { OverlayEvent } from './bridge';
import type { SceneCommand } from '../adapter';

/**
 * Relays adapter `openOverlay` commands to the world bus ('overlay'), which the world forwards to
 * the host's onOverlay and uses to lock input until `overlayClosed`.
 */
const mod: SceneModule = {
  id: 'overlay-bridge',
  order: 410,
  create(ctx) {
    const bridge = createOverlayBridge({
      // The world's OverlayEvent union gains `openConfirm` (requested); until then it is passed through as-is.
      onOverlay: (e: OverlayEvent) =>
        ctx.bus.emit('overlay', e as unknown as VillageBusEvents['overlay']),
    });
    const offCmd = ctx.bus.on('command', (cmd) => {
      if (cmd.type === 'openOverlay')
        bridge.handle((cmd as unknown as Extract<SceneCommand, { type: 'openOverlay' }>).request);
    });
    const offClosed = ctx.bus.on('overlayClosed', () => bridge.closed());
    return {
      destroy() {
        offCmd();
        offClosed();
        bridge.dispose();
      },
    };
  },
};
export default mod;
