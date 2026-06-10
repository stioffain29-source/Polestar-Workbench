/**
 * Test double for @workspace/db.
 * The real module opens a pg Pool at import time; unit tests must not need DATABASE_URL.
 */
export * from "../../lib/db/src/schema";

export const pool = {
  on: () => pool,
};

const chain = () => ({
  from: () => chain(),
  where: () => chain(),
  set: () => chain(),
  values: () => chain(),
  returning: () => Promise.resolve([]),
  then: (resolve: (value: unknown[]) => void) => resolve([]),
});

export const db = {
  select: () => chain(),
  insert: () => chain(),
  update: () => chain(),
  delete: () => chain(),
  execute: () => Promise.resolve({ rows: [] }),
};
