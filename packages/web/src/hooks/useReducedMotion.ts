import { useCalmMode } from './useCalmMode';
import { useMediaQuery } from './useMediaQuery';

/** True when the OS asks for reduced motion OR Calm mode is on. */
export function useReducedMotion(): boolean {
  const os = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [calm] = useCalmMode();
  return os || calm;
}
