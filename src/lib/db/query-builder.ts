// ============================================================================
// LocalQueryBuilder — a supabase-js-compatible query builder backed by SQLite
// ============================================================================
// Draymond's data layer was written against the PostgREST builder API
// (`supabase.from('t').select(...).eq(...).single()`). This class reimplements
// the subset of that API the codebase actually uses so the migration touches
// only the client factory, not ~150 call sites.
//
// Supported: select (+count/head), insert, upsert (onConflict), update,
// delete, eq/neq/gt/gte/lt/lte/in/is/contains/match/or filters, order, limit,
// range, single/maybeSingle, and the draymond_get_chain_execution_plan RPC.
// ============================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Db } from './connection';
import { COLUMN_MAPS } from './schema';

interface Filter {
  op: string;
  column: string;
  values: any[];
}

interface OrderBy {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

export type QueryMode = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

export interface QueryResult {
  data: any;
  count: number | null;
  error: { message: string; details: string; hint: string; code: string } | null;
}

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'contains' | 'match' | 'or';

const SQL_OPS: Record<string, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

function isJsonColumn(table: string, column: string): boolean {
  return COLUMN_MAPS[table]?.json.includes(column) ?? false;
}

function isBoolColumn(table: string, column: string): boolean {
  return COLUMN_MAPS[table]?.bool.includes(column) ?? false;
}

function toStored(value: any, table: string, column: string): any {
  if (value == null) return null;
  if (isBoolColumn(table, column) && typeof value === 'boolean') return value ? 1 : 0;
  if (isJsonColumn(table, column) && (typeof value === 'object' || Array.isArray(value))) {
    return JSON.stringify(value);
  }
  return value;
}

function toJs(value: any, table: string, column: string): any {
  if (value == null) return null;
  if (isBoolColumn(table, column)) return value === 1 || value === true;
  if (isJsonColumn(table, column) && typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}



/** Timestamp columns whose Postgres default is now() — auto-filled when absent. */
const AUTO_NOW_COLUMNS = new Set([
  'run_at',
  'granted_at',
  'started_at',
  'initiated_at',
  'last_accessed_at',
]);

export class LocalQueryBuilder {
  private db: Db;
  private table: string;
  private mode: QueryMode = 'select';
  private selectedColumns: string[] | null = null;
  private countOption: 'exact' | 'planned' | 'estimated' | null = null;
  private headOnly = false;
  private filters: Filter[] = [];
  private orderBy: OrderBy[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private payload: any = null;
  private onConflict: string[] = ['id'];
  private ignoreDuplicates = false;
  private selectAfterWrite = false;
  private singleResult = false;
  private maybeSingleResult = false;
  private rpcName: string | null = null;
  private rpcArgs: Record<string, any> | null = null;
  private allowInsert = false;

  constructor(db: Db, table: string) {
    this.db = db;
    this.table = table;
  }

  // ── thenable ──────────────────────────────────────────────────────────────

  then<T1 = QueryResult, T2 = never>(
    onfulfilled?: ((value: QueryResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<T2 = never>(onrejected?: (reason: unknown) => T2 | PromiseLike<T2>): Promise<QueryResult | T2> {
    return this.execute().then(undefined, onrejected);
  }

  finally(onfinally?: () => void): Promise<QueryResult> {
    return this.execute().finally(onfinally);
  }

  // ── query construction ────────────────────────────────────────────────────

  select(columns?: string | Record<string, unknown>, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    if (this.mode === 'select') {
      this.setSelection(columns);
      this.countOption = options?.count ?? null;
      this.headOnly = options?.head ?? false;
    } else {
      // In a write mode, `.select()` is the PostgREST "returning" modifier.
      this.selectAfterWrite = true;
      this.setSelection(columns);
      if (options?.count) this.countOption = options.count;
    }
    return this;
  }

  private setSelection(columns?: string | Record<string, unknown>): void {
    if (typeof columns === 'string') {
      this.selectedColumns = columns === '*' ? null : columns.split(',').map((c) => c.trim());
    } else if (typeof columns === 'object' && columns !== null) {
      this.selectedColumns = Object.keys(columns);
    } else {
      this.selectedColumns = null;
    }
  }

  insert(rows: any): this {
    this.mode = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.allowInsert = true;
    return this;
  }

  upsert(rows: any, options?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.mode = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.allowInsert = true;
    this.onConflict = options?.onConflict
      ? options.onConflict.split(',').map((c) => c.trim())
      : ['id'];
    this.ignoreDuplicates = options?.ignoreDuplicates ?? false;
    return this;
  }

  update(values: Record<string, any>): this {
    this.mode = 'update';
    this.payload = { ...values };
    this.allowInsert = false;
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    this.allowInsert = false;
    return this;
  }

  rpc(fn: string, args?: Record<string, any>): this {
    this.rpcName = fn;
    this.rpcArgs = args ?? {};
    return this;
  }

  eq(column: string, value: any): this {
    return this.pushFilter('eq', column, [value]);
  }
  neq(column: string, value: any): this {
    return this.pushFilter('neq', column, [value]);
  }
  gt(column: string, value: any): this {
    return this.pushFilter('gt', column, [value]);
  }
  gte(column: string, value: any): this {
    return this.pushFilter('gte', column, [value]);
  }
  lt(column: string, value: any): this {
    return this.pushFilter('lt', column, [value]);
  }
  lte(column: string, value: any): this {
    return this.pushFilter('lte', column, [value]);
  }
  in(column: string, values: any[]): this {
    return this.pushFilter('in', column, values);
  }
  is(column: string, value: any): this {
    return this.pushFilter('is', column, [value]);
  }
  contains(column: string, value: any[] | any): this {
    return this.pushFilter('contains', column, Array.isArray(value) ? value : [value]);
  }
  match(values: Record<string, any>): this {
    for (const [k, v] of Object.entries(values)) this.pushFilter('eq', k, [v]);
    return this;
  }
  or(filterString: string): this {
    return this.pushFilter('or', '', [filterString]);
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orderBy.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst ?? false,
    });
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetValue = from;
    this.limitValue = to - from + 1;
    return this;
  }

  single(): this {
    this.singleResult = true;
    return this;
  }

  maybeSingle(): this {
    this.maybeSingleResult = true;
    return this;
  }

  private pushFilter(op: FilterOp, column: string, values: any[]): this {
    this.filters.push({ op, column, values });
    return this;
  }

  // ── execution ─────────────────────────────────────────────────────────────

  async execute(): Promise<QueryResult> {
    try {
      if (this.rpcName === 'draymond_get_chain_execution_plan') {
        return this.runChainPlan();
      }

      switch (this.mode) {
        case 'select':
          return this.runSelect();
        case 'insert':
          return this.runWrite('insert');
        case 'upsert':
          return this.runUpsert();
        case 'update':
          return this.runWrite('update');
        case 'delete':
          return this.runWrite('delete');
        default:
          return this.ok(null, null);
      }
    } catch (err) {
      return {
        data: null,
        count: null,
        error: {
          message: err instanceof Error ? err.message : String(err),
          details: '',
          hint: '',
          code: 'PGRST_ERROR',
        },
      };
    }
  }

  private ok(data: any, count: number | null): QueryResult {
    return { data, count, error: null };
  }

  private tableColumns(): Set<string> {
    const stmt = this.db.prepare(`PRAGMA table_info(${quoteIdent(this.table)})`);
    const cols = stmt.all() as Array<{ name: string }>;
    return new Set(cols.map((c) => c.name));
  }

  private whereClause(): { sql: string; params: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];

    for (const f of this.filters) {
      if (f.op === 'or') {
        const expr = this.buildOrExpression(f.values[0] as string, params);
        if (expr) clauses.push(`(${expr})`);
        continue;
      }
      if (f.op === 'contains') {
        const clause = this.buildContainsClause(f.column, f.values, params);
        if (clause) clauses.push(clause);
        continue;
      }
      const col = quoteIdent(f.column);
      if (f.op === 'in') {
        if (f.values.length === 0) {
          clauses.push('1 = 0');
          continue;
        }
        const placeholders = f.values.map((v) => {
          params.push(toStored(v, this.table, f.column));
          return '?';
        });
        clauses.push(`${col} IN (${placeholders.join(', ')})`);
        continue;
      }
      if (f.op === 'is') {
        const v = f.values[0];
        if (v === null) {
          clauses.push(`${col} IS NULL`);
        } else {
          params.push(toStored(v, this.table, f.column));
          clauses.push(`${col} IS ?`);
        }
        continue;
      }
      const sqlOp = SQL_OPS[f.op];
      const v = f.values[0];
      if (v === null) {
        clauses.push(f.op === 'eq' ? `${col} IS NULL` : `${col} IS NOT NULL`);
        continue;
      }
      params.push(toStored(v, this.table, f.column));
      clauses.push(`${col} ${sqlOp} ?`);
    }
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
  }

  private buildContainsClause(column: string, values: any[], params: any[]): string | null {
    if (!isJsonColumn(this.table, column)) return null;
    const col = quoteIdent(column);
    const parts = values.map((v) => {
      params.push(v);
      return `EXISTS (SELECT 1 FROM json_each(${col}) WHERE json_each.value = ?)`;
    });
    return `(${parts.join(' AND ')})`;
  }

  private buildOrExpression(filterString: string, params: any[]): string | null {
    const parts: string[] = [];
    for (const token of filterString.split(',')) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\.([a-zA-Z]+))?(?:\.(.*))?$/);
      if (!m) continue;
      const column = m[1];
      const op = m[2] ?? 'eq';
      const value: string = m[3] ?? '';
      const col = quoteIdent(column);
      if (op === 'ilike' || op === 'like') {
        // PostgREST uses % as wildcard; SQLite uses % too.
        params.push(value);
        if (op === 'ilike') {
          parts.push(`LOWER(${col}) LIKE LOWER(?)`);
        } else {
          parts.push(`${col} LIKE ?`);
        }
      } else if (op === 'in') {
        const items = value.split(/\(([^)]*)\)/).filter(Boolean)[0] ?? '';
        const vals = items.split(',').filter(Boolean);
        if (vals.length === 0) continue;
        const ph = vals.map((v) => {
          params.push(toStored(v, this.table, column));
          return '?';
        });
        parts.push(`${col} IN (${ph.join(', ')})`);
      } else if (SQL_OPS[op]) {
        params.push(toStored(value, this.table, column));
        parts.push(`${col} ${SQL_OPS[op]} ?`);
      }
    }
    return parts.length ? parts.join(' OR ') : null;
  }

  private orderClause(): string {
    if (this.orderBy.length === 0) return '';
    const parts = this.orderBy.map((o) => {
      const col = quoteIdent(o.column);
      const dir = o.ascending ? 'ASC' : 'DESC';
      if (o.nullsFirst) return `${col} ${dir} NULLS FIRST`;
      return `${col} ${dir}`;
    });
    return ` ORDER BY ${parts.join(', ')}`;
  }

  private limitOffset(): string {
    const clauses: string[] = [];
    if (this.limitValue != null) clauses.push(`LIMIT ${Math.max(0, Math.floor(this.limitValue))}`);
    if (this.offsetValue != null) clauses.push(`OFFSET ${Math.max(0, Math.floor(this.offsetValue))}`);
    return clauses.length ? ` ${clauses.join(' ')}` : '';
  }

  private runSelect(): QueryResult {
    const { sql, params } = this.whereClause();
    const table = quoteIdent(this.table);

    if (this.headOnly) {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table}${sql}`)
        .get(...params) as { n: number };
      return this.ok(null, row.n);
    }

    const cols = this.selectedColumns
      ? this.selectedColumns.map(quoteIdent).join(', ')
      : '*';
    const orderClause = this.orderClause();
    const lim = this.limitOffset();
    const stmt = this.db.prepare(
      `SELECT ${cols} FROM ${table}${sql}${orderClause}${lim}`
    );
    let rows = stmt.all(...params) as Record<string, any>[];

    const colMap = COLUMN_MAPS[this.table];
    if (colMap) {
      const conv = new Set([...colMap.bool, ...colMap.json]);
      rows = rows.map((r) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(r)) {
          out[k] = toJs(v, this.table, k);
        }
        void conv;
        return out;
      });
    }

    let count: number | null = null;
    if (this.countOption === 'exact') {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table}${sql}`)
        .get(...params) as { n: number };
      count = row.n;
    }

    return this.postProcessRows(rows, count);
  }

  private buildWriteRow(raw: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    const cols = this.tableColumns();
    const now = new Date().toISOString();

    if (cols.has('id') && !raw.id) out.id = crypto.randomUUID();
    if (cols.has('created_at') && !raw.created_at) out.created_at = now;
    if (cols.has('updated_at') && !raw.updated_at) out.updated_at = now;
    for (const autoNow of AUTO_NOW_COLUMNS) {
      if (cols.has(autoNow) && raw[autoNow] == null) out[autoNow] = now;
    }

    for (const [k, v] of Object.entries(raw)) {
      if (k === 'created_at' || k === 'updated_at') {
        out[k] = v ?? now;
        continue;
      }
      if (!cols.has(k)) continue;
      out[k] = toStored(v, this.table, k);
    }
    return out;
  }

  private postProcessRows(rows: Record<string, any>[], count: number | null): QueryResult {
    if (this.singleResult) {
      if (rows.length === 0) {
        return {
          data: null,
          count,
          error: {
            message: 'JSON object requested, multiple (or no) rows returned',
            details: 'The result contains 0 rows',
            hint: '',
            code: 'PGRST116',
          },
        };
      }
      if (rows.length > 1) {
        return {
          data: null,
          count,
          error: {
            message: 'JSON object requested, multiple (or no) rows returned',
            details: 'The result contains more than one row',
            hint: '',
            code: 'PGRST116',
          },
        };
      }
      return this.ok(rows[0], count);
    }

    if (this.maybeSingleResult) {
      if (rows.length === 0) return this.ok(null, count);
      if (rows.length > 1) {
        return {
          data: null,
          count,
          error: {
            message: 'JSON object requested, multiple (or no) rows returned',
            details: 'The result contains more than one row',
            hint: '',
            code: 'PGRST116',
          },
        };
      }
      return this.ok(rows[0], count);
    }

    return this.ok(rows, count);
  }

  private returningSelect(filters: Filter[]): Record<string, any>[] {
    const sel = new LocalQueryBuilder(this.db, this.table);
    sel.mode = 'select';
    sel.selectedColumns = this.selectedColumns;
    sel.filters = filters;
    const res = sel.runSelect();
    return (res.data as Record<string, any>[]) ?? [];
  }

  /** IDs matched by the current filters, captured before a write so the
   *  post-write returning rows can be re-selected without re-applying filters
   *  that the write itself may invalidate (PostgREST RETURNING parity). */
  private affectedIds(sql: string, params: any[]): string[] {
    if (!this.tableColumns().has('id')) return [];
    const rows = this.db.prepare(`SELECT id FROM ${quoteIdent(this.table)}${sql}`).all(...params) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  private runWrite(mode: 'insert' | 'update' | 'delete'): QueryResult {
    const table = quoteIdent(this.table);
    const cols = this.tableColumns();

    if (mode === 'insert') {
      const rows = (this.payload as any[]).map((r) => this.buildWriteRow(r));
      if (rows.length === 0) return this.ok(null, null);
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => cols.has(k));
      if (keys.length === 0) return this.ok(null, null);
      const insertSql = `INSERT INTO ${table} (${keys.map(quoteIdent).join(', ')}) VALUES (${keys
        .map(() => '?')
        .join(', ')})`;
      const insert = this.db.prepare(insertSql);
      const tx = this.db.transaction(() => {
        for (const r of rows) {
          insert.run(keys.map((k) => r[k] ?? null));
        }
      });
      tx();

      if (this.selectAfterWrite) {
        const ids = rows.map((r) => r.id).filter(Boolean);
        if (ids.length === 0) return this.ok([], null);
        return this.postProcessRows(this.returningSelect([{ op: 'in', column: 'id', values: ids }]), null);
      }
      return this.ok(null, null);
    }

    const { sql, params } = this.whereClause();
    const affected = this.selectAfterWrite ? this.affectedIds(sql, params) : [];
    if (mode === 'delete') {
      this.db.prepare(`DELETE FROM ${table}${sql}`).run(...params);
      if (this.selectAfterWrite) {
        const ids = affected.filter(Boolean);
        if (ids.length === 0) return this.ok([], null);
        return this.postProcessRows(this.returningSelect([{ op: 'in', column: 'id', values: ids }]), null);
      }
      return this.ok(null, null);
    }

    // update
    const now = new Date().toISOString();
    const values: Record<string, any> = {};
    for (const [k, v] of Object.entries(this.payload as Record<string, any>)) {
      if (!cols.has(k)) continue;
      values[k] = toStored(v, this.table, k);
    }
    if (cols.has('updated_at')) values.updated_at = this.payload.updated_at ?? now;
    const keys = Object.keys(values);
    if (keys.length === 0) return this.ok(null, null);
    const setSql = keys.map((k) => `${quoteIdent(k)} = ?`).join(', ');
    this.db
      .prepare(`UPDATE ${table} SET ${setSql}${sql}`)
      .run(...keys.map((k) => values[k]), ...params);
    if (this.selectAfterWrite) {
      const ids = affected.filter(Boolean);
      if (ids.length === 0) return this.ok([], null);
      return this.postProcessRows(this.returningSelect([{ op: 'in', column: 'id', values: ids }]), null);
    }
    return this.ok(null, null);
  }

  private runUpsert(): QueryResult {
    const table = quoteIdent(this.table);
    const cols = this.tableColumns();
    const rows = (this.payload as any[]).map((r) => this.buildWriteRow(r));
    if (rows.length === 0) return this.ok(null, null);

    // Everything except the conflict target + id gets DO UPDATE SET
    const conflictCols = this.onConflict.filter((c) => cols.has(c));
    if (conflictCols.length === 0) {
      return this.runWrite('insert');
    }
    const conflictSql = conflictCols.map(quoteIdent).join(', ');

    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => cols.has(k));
        // On conflict, update the caller-provided columns (minus the conflict
        // target, id, and created_at which Postgres preserves). updated_at is
        // bumped to match the old handle_updated_at trigger behavior.
        const nonConflict = keys.filter(
          (k) => k !== 'id' && !conflictCols.includes(k) && k !== 'created_at'
        );
        const insertSql = `INSERT INTO ${table} (${keys.map(quoteIdent).join(', ')}) VALUES (${keys
          .map(() => '?')
          .join(', ')}) ON CONFLICT (${conflictSql}) DO ${
          this.ignoreDuplicates
            ? 'NOTHING'
            : `UPDATE SET ${nonConflict
                .map((k) => `${quoteIdent(k)} = excluded.${quoteIdent(k)}`)
                .join(', ')}`
        }`;
        this.db
          .prepare(insertSql)
          .run(...keys.map((k) => row[k] ?? null));
      }
    });
    tx();

    if (this.selectAfterWrite) {
      // Re-select each affected row by its conflict-target columns so the
      // returning data reflects the current (post-upsert) state.
      const results: Record<string, any>[] = [];
      for (const row of rows) {
        const filters = conflictCols.map((c) => ({
          op: 'eq' as const,
          column: c,
          values: [row[c] ?? null],
        }));
        results.push(...this.returningSelect(filters));
      }
      return this.postProcessRows(results, null);
    }
    return this.ok(null, null);
  }

  private runChainPlan(): QueryResult {
    const chainId = this.rpcArgs?.p_chain_id as string | undefined;
    if (!chainId) {
      return {
        data: null,
        count: null,
        error: {
          message: 'p_chain_id is required',
          details: '',
          hint: '',
          code: 'PGRST_ERROR',
        },
      };
    }
    const rows = this.db
      .prepare(
        `SELECT cs.id AS step_id, cs.step_order, cs.name AS step_name,
                cs.entity_id, e.name AS entity_name, e.kind AS entity_kind,
                cs.parallel_group, cs.depends_on_steps, cs.status
         FROM draymond_chain_steps cs
         JOIN draymond_entities e ON e.id = cs.entity_id
         WHERE cs.chain_id = ?
         ORDER BY cs.step_order, cs.parallel_group`
      )
      .all(chainId) as Record<string, any>[];

    const data = rows.map((r) => ({
      ...r,
      depends_on_steps: r.depends_on_steps ? JSON.parse(r.depends_on_steps) : [],
    }));
    return this.ok(data, null);
  }
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export function createQueryBuilder(db: Db, table: string): LocalQueryBuilder {
  return new LocalQueryBuilder(db, table);
}
