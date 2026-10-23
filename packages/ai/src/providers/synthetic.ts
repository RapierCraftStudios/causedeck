// A schema-valid synthetic value for any zod schema the task registry uses. The mock provider
// falls back to it when no fixture matches, so every pipeline runs offline.
import type { z } from 'zod';

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  entries?: Record<string, unknown>;
  values?: unknown[];
  innerType?: z.ZodType;
  options?: z.ZodType[];
}

const STRING_CANDIDATES = ['mock', '2026-01-01', 'mock-1', 'en'];

export function synthesise(schema: z.ZodType): unknown {
  const def = (schema as unknown as { _zod: { def: Def } })._zod.def;
  switch (def.type) {
    case 'object':
      return Object.fromEntries(
        Object.entries(def.shape ?? {})
          .filter(([, field]) => !field.safeParse(undefined).success)
          .map(([key, field]) => [key, synthesise(field)]),
      );
    case 'array':
      return [];
    case 'string': {
      const found = STRING_CANDIDATES.find((c) => schema.safeParse(c).success);
      if (found !== undefined) return found;
      const min = (schema as unknown as { minLength: number | null }).minLength ?? 1;
      return 'mock'.padEnd(min, 'x');
    }
    case 'number': {
      const { minValue, maxValue } = schema as unknown as {
        minValue: number | null;
        maxValue: number | null;
      };
      const value = Math.max(minValue ?? 0, 0);
      return maxValue !== null && value > maxValue ? maxValue : value;
    }
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'nullable':
      return null;
    case 'optional':
    case 'default':
    case 'readonly':
      return def.innerType === undefined ? undefined : synthesise(def.innerType);
    case 'enum':
      return Object.values(def.entries ?? {})[0];
    case 'literal':
      return def.values?.[0];
    case 'union': {
      const first = def.options?.[0];
      return first === undefined ? undefined : synthesise(first);
    }
    case 'record':
      return {};
    default:
      throw new Error(`mock provider cannot synthesise a ${def.type} value`);
  }
}
