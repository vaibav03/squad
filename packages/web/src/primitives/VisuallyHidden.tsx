import type { ElementType, ReactNode } from 'react';

export function VisuallyHidden({ children, as: As = 'span' }: { children: ReactNode; as?: ElementType }) {
  return <As className="sq-sr-only">{children}</As>;
}
