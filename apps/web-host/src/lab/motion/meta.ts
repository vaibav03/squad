// Structural twin of `LabMeta` from '@squad/web' (web-shell contract). Not imported so the Lab
// stays loadable where that export does not exist yet.
interface LabMetaLike {
  path: string;
  title: string;
  description?: string;
}

export const meta = {
  path: '__motion',
  title: 'Motion Lab',
  description: 'Every animation, looped, 0.25x, frame stepper',
} satisfies LabMetaLike;
