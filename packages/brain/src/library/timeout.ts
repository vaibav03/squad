import { LibraryError } from './types';

/** Races `p` against a timer. The underlying work is not cancelled (pure-JS parsing), its result is dropped. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new LibraryError('timeout')), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
