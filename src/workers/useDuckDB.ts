/**
 * useDuckDB — browser DuckDB-Wasm for CSV/JSON/Parquet analytics.
 * Ported from @mathx/web (apps/web/src/workers/useDuckDB.ts).
 */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function useDuckDB() {
  const [ready, setReady] = useState(false);
  const dbRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    let disposed = false;
    async function init() {
      try {
        const duckdb = await import('@duckdb/duckdb-wasm');
        const bundles = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(bundles);
        const workerUrl = URL.createObjectURL(
          new Blob([`importScripts('${bundle.mainWorker}');`], { type: 'application/javascript' }),
        );
        const worker = new Worker(workerUrl);
        workerRef.current = worker;
        const logger = new duckdb.ConsoleLogger();
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        const conn = await db.connect();
        dbRef.current = db;
        connRef.current = conn;
        if (!disposed) setReady(true);
      } catch (err) {
        console.warn('[duckdb] init failed:', err);
      }
    }
    init();
    return () => {
      disposed = true;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const query = useCallback(async (sql: string): Promise<any[]> => {
    if (!connRef.current) return [];
    const result = await connRef.current.query(sql);
    return result.toArray().map((row: any) => row.toJSON());
  }, []);

  const loadFile = useCallback(async (file: File): Promise<string> => {
    if (!dbRef.current || !connRef.current) return '';
    const buf = await file.arrayBuffer();
    const tableName = file.name.replace(/[^a-z0-9_]/gi, '_').replace(/\.[^.]+$/, '');
    await dbRef.current.registerFileBuffer(file.name, new Uint8Array(buf));
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      await connRef.current.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${file.name}')`);
    } else if (ext === 'json') {
      await connRef.current.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${file.name}')`);
    } else if (ext === 'parquet') {
      await connRef.current.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_parquet('${file.name}')`);
    }
    return tableName;
  }, []);

  return { ready, query, loadFile };
}
