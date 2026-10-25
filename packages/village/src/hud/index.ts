// STUB (replaced by the camera+HUD sub-agent). Signatures are the contract.
import type {
  AgentRegistry,
  CameraApi,
  Interactable,
  PlayerApi,
  VillageBus,
  WorldLayout,
  WorldTime,
} from '../world/api';

export interface HudDeps {
  parent: HTMLElement; // mount container; HUD DOM is appended here, above the canvas
  bus: VillageBus;
  agents: AgentRegistry;
  camera: Pick<CameraApi, 'setMode' | 'mode'>;
  player: Pick<PlayerApi, 'walkTo'>;
  layout: WorldLayout;
  time: WorldTime;
  interactables: { list(): Interactable[] };
  calm: { get(): boolean; set(v: boolean): void };
  /** Tap on a state chip: walk to that agent's slot door and focus it. */
  focusAgent(agentId: string): void;
}
export function createHud(_d: HudDeps): { update(): void; destroy(): void } {
  return { update() {}, destroy() {} };
}
