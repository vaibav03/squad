import { verifyClaims } from '../../../../packages/brain/src/citations/check';

type Pages = Parameters<typeof verifyClaims>[1];
export const verifyQuote = (
  c: Record<string, unknown>[],
  pages: { file: string; page: number; text: string }[],
) => verifyClaims(c as unknown as Parameters<typeof verifyClaims>[0], pages as unknown as Pages);
