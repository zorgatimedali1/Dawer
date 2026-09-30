import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `node:sqlite` is not listed in `module.builtinModules` on Node 22, so Vite tries
 * to resolve it as a file. Loading it through `createRequire` keeps it opaque to the
 * bundler while still hitting the real engine.
 */
type SqliteStatement = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
};

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../../db/schema.sql');

type Args = unknown[];

class TestStatement {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly sql: string,
    private readonly params: Args = [],
  ) {}

  bind(...values: Args): TestStatement {
    return new TestStatement(this.db, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as never[]));
    return (row ?? null) as T | null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
    const rows = this.db.prepare(this.sql).all(...(this.params as never[]));
    return { results: rows as T[], success: true, meta: {} };
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    const info = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export class TestDatabase {
  readonly sqlite: SqliteDatabase;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(readFileSync(schemaPath, 'utf8'));
  }

  prepare(sql: string): TestStatement {
    return new TestStatement(this.sqlite, sql);
  }

  /** Convenience for tests: run a statement and return the single scalar/row. */
  query<T>(sql: string, ...params: Args): T[] {
    return this.sqlite.prepare(sql).all(...(params as never[])) as T[];
  }

  async batch(statements: TestStatement[]): Promise<{ results: unknown[] }> {
    this.sqlite.exec('BEGIN');
    try {
      for (const statement of statements) await statement.run();
      this.sqlite.exec('COMMIT');
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
    return { results: [] };
  }

  close(): void {
    this.sqlite.close();
  }
}

export function createTestEnv(): { DB: TestDatabase } {
  return { DB: new TestDatabase() };
}
