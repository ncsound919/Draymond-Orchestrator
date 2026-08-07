import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROUTE = fileURLToPath(new URL('../src/app/api/entities/route.ts', import.meta.url));
const src = readFileSync(ROUTE, 'utf-8');

describe('entities route kind whitelist', () => {
  it('accepts every EntityKind including skill/extension/mcp_server', () => {
    for (const kind of ['skill', 'extension', 'mcp_server', 'agent', 'tool', 'service', 'workflow', 'data_source', 'integration']) {
      expect(src).toContain(`'${kind}'`);
    }
  });

  it('explicitly lists skill in VALID_KINDS', () => {
    expect(src).toMatch(/VALID_KINDS = \[[^\]]*'skill'[^\]]*\]/);
  });
});
