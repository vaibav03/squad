/** Build-time config injected by scripts/build.mjs (esbuild `define`). Local defaults only; never real hosts. */
declare const __SQUAD_HUB_URL__: string;
declare const __SQUAD_WEB_ORIGIN__: string;

export const NAMESPACE = 'squad';
export const HUB_BASE: string =
  typeof __SQUAD_HUB_URL__ === 'string' ? __SQUAD_HUB_URL__ : 'http://localhost:8930';
export const WEB_ORIGIN: string =
  typeof __SQUAD_WEB_ORIGIN__ === 'string' ? __SQUAD_WEB_ORIGIN__ : 'http://localhost:5330';
