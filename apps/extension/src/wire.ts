export function extensionMessageTypes(ns: string) {
  return {
    ping: `${ns}:ping`,
    ready: `${ns}:extension-ready`,
    bridgeRequest: `${ns}:bridge-request`,
    bridgeResponse: `${ns}:bridge-response`,
    canvasStatus: `${ns}:canvas-status`,
    canvasAuthorize: `${ns}:canvas-authorize`,
    canvasOpenSignIn: `${ns}:canvas-open-sign-in`,
  } as const;
}
export const extensionMarkerAttribute = (ns: string) => `data-${ns}-extension`;
export const EXTENSION_MARKER_VALUE = '1';
