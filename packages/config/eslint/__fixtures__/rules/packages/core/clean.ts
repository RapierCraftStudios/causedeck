export function parse(input: unknown): string {
  return typeof input === 'string' ? input : '';
}
