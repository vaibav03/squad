import { mountInterior } from '../src/index';
import { createManualSource } from '../src/shared/sources';

const q = new URLSearchParams(location.search);
const source = createManualSource();
const handle = mountInterior({
  parent: document.getElementById('app')!,
  source,
  assetBase: '/assets',
  calm: q.has('calm'),
  camera: q.get('camera') === 'follow' ? 'follow' : 'room',
  seed: Number(q.get('seed') ?? 1),
  onOverlay: (e) => {
    console.info('[overlay]', e);
    // The dev host has no panels: close immediately after a beat so input unlocks.
    setTimeout(() => handle.overlayClosed(), 600);
  },
});

const story = [
  { t: 'agent.state', agent: 'student:ana', state: 'idle' },
  { t: 'agent.state', agent: 'expert:ch1', state: 'studying' },
  { t: 'agent.state', agent: 'student:ben', state: 'idle' },
  { t: 'agent.state', agent: 'student:cy', state: 'studying' },
  { t: 'agent.state', agent: 'student:dee', state: 'idle' },
] as const;
if (!q.has('nostory')) story.forEach((e, i) => setTimeout(() => source.emit(e), 300 + i * 150));

Object.assign(window, { __interior: handle, __source: source });
