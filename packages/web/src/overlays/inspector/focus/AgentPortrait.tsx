/**
 * Portrait of the focused agent. A thin wrapper so the shared portrait/crest component from the design-system work can
 * replace the pixel image in one place.
 */
export function AgentPortrait({ src }: { src: string }) {
  return <img src={src} alt="" width={56} height={56} />;
}
