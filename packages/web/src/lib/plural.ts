/** `plural(1, 'Classroom item')` -> '1 Classroom item'; `plural(2, 'Classroom item')` -> '2 Classroom items'; 0 -> '0 items'. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
