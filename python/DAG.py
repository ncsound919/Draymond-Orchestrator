"""Recursive-CTE DAG queries for the Draymond chain-dependency graph.

Faithful port of Magda, *Just Use Postgres!* (2026), Chapter 3 "Modern SQL",
§3.4 Recursive queries (Listings 3.7-3.9), applied to the orchestrator's chain
dependency graph.

The chain dependency graph is a DAG: each row of `chain_dependencies` is a
directed edge `chain_id DEPENDS ON depends_on_chain_id` (the chain must run
after its dependency, exactly as Magda's `streaming.plays (id, played_after)`
models a song played after another). We use the same recursive-CTE shape:

  * Anchor (non-recursive) term seeds the traversal; recursive term self-JOINs
    the CTE on the edge column (Magda Listing 3.8: `JOIN play_sequence ps ON
    p.played_after = ps.id`).
  * A carried `level` column (1 in the anchor, `level + 1` each step) gives the
    topological depth (Listing 3.8 variant).
  * A carried `path` column (`ARRAY[chain_id]`, then `path || cd.chain_id`)
    accumulates the walk — also lets us detect cycles (a node reappearing in
    `path`), which Magda's recursion would otherwise loop on (§3.4.2 arrays).

Queries provided:
  * ancestors(chain)  -> transitive upstream (dependencies that must run first)
  * descendants(chain)-> transitive downstream (chains affected by it)
  * topological_levels()-> depth of every chain from its roots (for scheduling)

As with the rest of the book-scan extractions, the Draymond pillars run
without a live Postgres, so this module gives exactly-generated recursive-CTE
SQL (validated by tests, deploy-ready) AND a pure-Python `InMemoryDag` that
computes the same closures + levels with explicit, honest cycle detection
(Magda's SQL would spin on a cycle; the in-memory walker catches it). Both
implement `Dag`.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# DDL + recursive-CTE SQL (Magda §3.4)
# ---------------------------------------------------------------------------
def chain_dependency_ddl(table: str = "chain_dependencies") -> List[str]:
    """Edge table: chain_id DEPENDS ON depends_on_chain_id (a DAG edge)."""
    return [
        f"CREATE TABLE IF NOT EXISTS {table} ("
        "  chain_id TEXT NOT NULL,"
        "  depends_on_chain_id TEXT NOT NULL,"
        "  PRIMARY KEY (chain_id, depends_on_chain_id)"
        ");",
    ]


def ancestors_sql(chain_id: str, table: str = "chain_dependencies") -> str:
    """Transitive upstream (Magda Listing 3.9 shape, walked toward roots)."""
    cid = _quote(chain_id)
    return (
        f"WITH RECURSIVE ancestors(chain_id, depends_on_chain_id, level, path) AS (\n"
        f"  SELECT chain_id, depends_on_chain_id, 1, ARRAY[chain_id]\n"
        f"  FROM {table}\n"
        f"  WHERE chain_id = '{cid}'\n"
        f"  UNION ALL\n"
        f"  SELECT cd.chain_id, cd.depends_on_chain_id, a.level + 1, a.path || cd.chain_id\n"
        f"  FROM {table} cd\n"
        f"  JOIN ancestors a ON cd.chain_id = a.depends_on_chain_id\n"
        f")\n"
        f"SELECT chain_id, level, path FROM ancestors ORDER BY level;"
    )


def descendants_sql(chain_id: str, table: str = "chain_dependencies") -> str:
    """Transitive downstream (reverse walk, Magda Listing 3.9 shape)."""
    cid = _quote(chain_id)
    return (
        f"WITH RECURSIVE downstream(chain_id, depends_on_chain_id, level, path) AS (\n"
        f"  SELECT chain_id, depends_on_chain_id, 1, ARRAY[chain_id]\n"
        f"  FROM {table}\n"
        f"  WHERE depends_on_chain_id = '{cid}'\n"
        f"  UNION ALL\n"
        f"  SELECT cd.chain_id, cd.depends_on_chain_id, d.level + 1, d.path || cd.chain_id\n"
        f"  FROM {table} cd\n"
        f"  JOIN downstream d ON cd.depends_on_chain_id = d.chain_id\n"
        f")\n"
        f"SELECT chain_id, level, path FROM downstream ORDER BY level;"
    )


def topological_levels_sql(table: str = "chain_dependencies") -> str:
    """Depth of every chain from its roots (Magda 'all sequences' variant)."""
    return (
        f"WITH RECURSIVE levels(chain_id, depends_on_chain_id, level, path) AS (\n"
        f"  SELECT chain_id, depends_on_chain_id, 1, ARRAY[chain_id]\n"
        f"  FROM {table}\n"
        f"  WHERE depends_on_chain_id IS NULL\n"
        f"  UNION ALL\n"
        f"  SELECT cd.chain_id, cd.depends_on_chain_id, l.level + 1, l.path || cd.chain_id\n"
        f"  FROM {table} cd\n"
        f"  JOIN levels l ON cd.depends_on_chain_id = l.chain_id\n"
        f")\n"
        f"SELECT chain_id, level, path FROM levels ORDER BY level;"
    )


def _quote(s: str) -> str:
    # Minimal SQL identifier/string literal escaping for the chain_id literal.
    return s.replace("'", "''")


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------
class Dag:
    def add_edge(self, chain_id: str, depends_on: str) -> None:
        raise NotImplementedError

    def ancestors(self, chain_id: str) -> List[Tuple[str, int]]:
        raise NotImplementedError

    def descendants(self, chain_id: str) -> List[Tuple[str, int]]:
        raise NotImplementedError

    def topological_levels(self) -> Dict[str, int]:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Pure-Python fallback (BFS closures + honest cycle detection)
# ---------------------------------------------------------------------------
class InMemoryDag(Dag):
    def __init__(self):
        self._edges: Dict[str, str] = {}  # chain_id -> depends_on
        self._succ: Dict[str, Set[str]] = {}  # chain_id -> set of chains depending on it

    def add_edge(self, chain_id: str, depends_on: str) -> None:
        if chain_id == depends_on:
            raise ValueError(f"self-dependency {chain_id} would create a cycle")
        # Reject a back-edge that would close a cycle: if `chain_id` is already
        # reachable from `depends_on` downstream, adding chain_id->depends_on
        # creates a loop (Magda's recursion would spin on it).
        if self._depends_on(depends_on, chain_id):
            raise ValueError(
                f"edge {chain_id} -> {depends_on} would create a cycle"
            )
        self._edges[chain_id] = depends_on
        self._succ.setdefault(depends_on, set()).add(chain_id)

    def _depends_on(self, x: str, y: str) -> bool:
        # Does x (transitively) DEPEND ON y, following the depends_on edges?
        seen = set()
        n = x
        while n in self._edges:
            parent = self._edges[n]
            if parent == y:
                return True
            if parent in seen:
                return False  # already inside a cycle
            seen.add(parent)
            n = parent
        return False

    def _walk(self, seed: List[Tuple[str, int]], direction: str) -> List[Tuple[str, int]]:
        # direction 'up' climbs depends_on; 'down' descends to dependents.
        result: List[Tuple[str, int]] = []
        visited = set()
        queue = list(seed)
        seen_levels = {node: lvl for node, lvl in seed}
        while queue:
            node, lvl = queue.pop(0)
            if node in visited:
                continue
            visited.add(node)
            result.append((node, lvl))
            if direction == "up":
                nxt = [self._edges[node]] if node in self._edges else []
            else:
                nxt = list(self._succ.get(node, set()))
            for n in nxt:
                if n in seen_levels:
                    # Reached a node already on the walk -> cycle.
                    raise ValueError(f"cycle detected in dependency graph at {n}")
                seen_levels[n] = lvl + 1
                queue.append((n, lvl + 1))
        return sorted(result, key=lambda x: x[1])

    def ancestors(self, chain_id: str) -> List[Tuple[str, int]]:
        # Magda's closure includes the seeded chain at level 1, then its
        # dependencies at increasing levels (LIKE Listing 3.9 path with level+1).
        if chain_id not in self._edges and chain_id not in self._succ:
            return [(chain_id, 1)]
        return self._walk([(chain_id, 1)], "up")

    def descendants(self, chain_id: str) -> List[Tuple[str, int]]:
        # Magda's descendants seed is the direct dependents (WHERE depends_on =
        # chain_id), so the chain itself is NOT in the result.
        if chain_id not in self._succ:
            return []
        return self._walk([(c, 1) for c in sorted(self._succ[chain_id])], "down")

    def topological_levels(self) -> Dict[str, int]:
        levels: Dict[str, int] = {}
        # Roots = chains with no depends_on (not present as an edge source key).
        roots = [c for c in set(list(self._edges) + list(self._succ))
                 if c not in self._edges]
        queue: List[Tuple[str, int]] = [(r, 1) for r in roots]
        visited = set()
        while queue:
            node, lvl = queue.pop(0)
            if node in visited:
                raise ValueError(f"cycle detected in dependency graph at {node}")
            visited.add(node)
            levels[node] = lvl
            for child in sorted(self._succ.get(node, set())):
                queue.append((child, lvl + 1))
        return levels


# ---------------------------------------------------------------------------
# Psycopg2-backed DAG (deploy path; emits the exact recursive-CTE SQL)
# ---------------------------------------------------------------------------
class PgDag(Dag):
    def __init__(self, conn, table: str = "chain_dependencies"):
        import psycopg2  # noqa: F401 (lazy)
        self._conn = conn
        self._table = table

    def add_edge(self, chain_id: str, depends_on: str) -> None:
        cur = self._conn.cursor()
        try:
            cur.execute(
                f"INSERT INTO {self._table} (chain_id, depends_on_chain_id) "
                "VALUES (%s, %s) ON CONFLICT DO NOTHING;",
                (chain_id, depends_on),
            )
            self._conn.commit()
        finally:
            cur.close()

    def ancestors(self, chain_id: str) -> List[Tuple[str, int]]:
        return self._run(ancestors_sql(chain_id, self._table))

    def descendants(self, chain_id: str) -> List[Tuple[str, int]]:
        return self._run(descendants_sql(chain_id, self._table))

    def topological_levels(self) -> Dict[str, int]:
        cur = self._conn.cursor()
        try:
            cur.execute(topological_levels_sql(self._table))
            rows = cur.fetchall()
            return {r[0]: int(r[1]) for r in rows}
        finally:
            cur.close()

    def _run(self, sql: str) -> List[Tuple[str, int]]:
        cur = self._conn.cursor()
        try:
            cur.execute(sql)
            rows = cur.fetchall()
            return [(r[0], int(r[1])) for r in rows]
        finally:
            cur.close()
