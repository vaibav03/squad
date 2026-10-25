/** `plural(1, 'option')` -> '1 option'; `plural(2, 'option')` -> '2 options'; 0 -> '0 options'. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
