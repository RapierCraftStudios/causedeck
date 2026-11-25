// The in-memory database of the bulk importer tests (#890, #1185): the cursor, judgment and OCR queue
// tables, shared by import.test.ts and import.memory.test.ts.
import { schema, type Queryable } from '@causedeck/db';

const { judgment, corpusImportCursor, corpusOcrQueue } = schema;

/** In-memory stand-in for the three tables the importer touches. */
export function fakeDb() {
  const judgments: { id: string; sha256: string; values: Record<string, unknown> }[] = [];
  const cursors: Record<string, unknown>[] = [];
  const queue: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        return {
          where: (cond: unknown) => ({
            limit: () => {
              if (table !== judgment) return Promise.resolve(cursors.slice(0, 1));
              const sha = /[0-9a-f]{64}/.exec(
                JSON.stringify(cond, (k, v: unknown) => (k === 'table' ? undefined : v)),
              )?.[0];
              return Promise.resolve(
                judgments.filter((r) => r.sha256 === sha).map((r) => ({ id: r.id })),
              );
            },
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> & { sha256?: string }) => ({
        onConflictDoNothing: () => {
          if (table === corpusImportCursor) {
            if (cursors.length === 0) {
              cursors.push({ id: 'c1', position: 0, status: 'pending', ...values });
            }
            return Promise.resolve();
          }
          if (table === corpusOcrQueue) {
            queue.push(...(values as unknown as Record<string, unknown>[]));
            return Promise.resolve();
          }
          return {
            returning: () => {
              if (judgments.some((r) => r.sha256 === values.sha256)) return Promise.resolve([]);
              const id = `j${String(judgments.length + 1)}`;
              judgments.push({ id, sha256: values.sha256 ?? '', values });
              return Promise.resolve([{ id }]);
            },
          };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const { position, status } = values;
          if (position !== undefined) cursors[0] = { ...cursors[0], position };
          if (status !== undefined) cursors[0] = { ...cursors[0], status };
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db: db as unknown as Queryable, judgments, cursors, queue };
}
