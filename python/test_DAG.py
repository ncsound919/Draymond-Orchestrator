"""Tests for the recursive-CTE DAG (Magda Ch3 §3.4).
Run: python test_DAG.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import DAG as m  # noqa: E402

# Stub psycopg2 so PgDag can be constructed without the driver.
sys.modules.setdefault("psycopg2", types.ModuleType("psycopg2"))

passed = 0
failed = 0


def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok - {msg}")
    else:
        failed += 1
        print(f"  FAIL - {msg}")


# --------------------------------------------------------------------------
def test_ddl():
    print("dag.ddl:")
    ddl = m.chain_dependency_ddl()
    joined = "\n".join(ddl)
    check("CREATE TABLE IF NOT EXISTS chain_dependencies (" in joined,
          "chain_dependencies edge table created")
    check("chain_id TEXT NOT NULL," in joined, "chain_id column")
    check("depends_on_chain_id TEXT NOT NULL" in joined, "depends_on_chain_id column")
    check("PRIMARY KEY (chain_id, depends_on_chain_id)" in joined,
          "primary key on the edge (no duplicate edges)")


def test_ancestors_sql():
    print("dag.ancestors_sql:")
    sql = m.ancestors_sql("report")
    check("WITH RECURSIVE ancestors(chain_id, depends_on_chain_id, level, path) AS (" in sql,
          "WITH RECURSIVE cte (Listing 3.7/3.8 shape)")
    check("ARRAY[chain_id]" in sql, "carried path ARRAY[chain_id] (§3.4.2)")
    check("a.level + 1" in sql, "level incremented each recursion (Listing 3.8)")
    check("a.path || cd.chain_id" in sql, "path appends node each step (§3.4.2)")
    check("UNION ALL" in sql, "UNION ALL merges (Magda Listing 3.8)")
    check("JOIN ancestors a ON cd.chain_id = a.depends_on_chain_id" in sql,
          "recursive self-JOIN on the edge column (Listing 3.8)")
    check("WHERE chain_id = 'report'" in sql, "anchor seeds the seeded chain")
    check(sql.strip().endswith("ORDER BY level;"), "primary statement orders by level")


def test_descendants_sql():
    print("dag.descendants_sql:")
    sql = m.descendants_sql("ingest")
    check("WITH RECURSIVE downstream(chain_id, depends_on_chain_id, level, path) AS (" in sql,
          "WITH RECURSIVE cte for downstream")
    check("WHERE depends_on_chain_id = 'ingest'" in sql,
          "anchor seeds the direct dependents (reverse walk)")
    check("JOIN downstream d ON cd.depends_on_chain_id = d.chain_id" in sql,
          "recursive self-JOIN reversed (downstream)")
    check("d.level + 1" in sql, "level incremented downstream")
    check(sql.strip().endswith("ORDER BY level;"), "orders by level")


def test_topo_sql():
    print("dag.topological_levels_sql:")
    sql = m.topological_levels_sql()
    check("WITH RECURSIVE levels(chain_id, depends_on_chain_id, level, path) AS (" in sql,
          "WITH RECURSIVE levels cte")
    check("WHERE depends_on_chain_id IS NULL" in sql,
          "anchor seeds the roots (no dependency) (Magda 'all sequences')")
    check("JOIN levels l ON cd.depends_on_chain_id = l.chain_id" in sql,
          "recursive self-JOIN to assign depth")


# --------------------------------------------------------------------------
def build_sample():
    g = m.InMemoryDag()
    # ingest <- transform <- train <- evaluate <- report
    g.add_edge("transform", "ingest")
    g.add_edge("train", "transform")
    g.add_edge("evaluate", "train")
    g.add_edge("report", "evaluate")
    return g


def test_inmemory():
    print("dag.inmemory:")
    g = build_sample()

    anc = dict(g.ancestors("report"))
    check(set(anc) == {"report", "evaluate", "train", "transform", "ingest"},
          "ancestors(report) = full upstream chain")
    check(anc["report"] == 1 and anc["ingest"] == 5,
          "ancestor levels increase with distance (Magda level+1)")

    desc = dict(g.descendants("ingest"))
    check(set(desc) == {"transform", "train", "evaluate", "report"},
          "descendants(ingest) = full downstream chain")
    check("ingest" not in desc, "descendants (Magda form) excludes the seed chain")
    check(desc["transform"] == 1 and desc["report"] == 4,
          "descendant levels increase with distance")

    levels = g.topological_levels()
    check(levels == {"ingest": 1, "transform": 2, "train": 3, "evaluate": 4, "report": 5},
          "topological_levels assign depth from roots")


def test_cycle():
    print("dag.cycle:")
    g = m.InMemoryDag()
    g.add_edge("a", "b")
    g.add_edge("b", "c")
    raised = False
    try:
        g.add_edge("c", "a")  # closes a -> b -> c -> a
    except ValueError:
        raised = True
    check(raised, "self-closed cycle is rejected on add_edge")

    g2 = m.InMemoryDag()
    g2.add_edge("b", "a")
    g2.add_edge("c", "b")
    raised2 = False
    try:
        g2.ancestors("c")  # c->b->a, no cycle -> fine
    except ValueError:
        raised2 = True
    check(not raised2, "acyclic chain walks without false cycle detection")
    raised3 = False
    try:
        # Force a cycle through mutation after build.
        g2._edges["a"] = "c"
        g2.ancestors("c")
    except ValueError:
        raised3 = True
    check(raised3, "cycle detected during walk (Magda's recursion would loop)")


# --------------------------------------------------------------------------
class _FakeCursor:
    def __init__(self):
        self.calls = []
        self._rows = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))

    def fetchall(self):
        return self._rows

    def close(self):
        pass


class _FakeConn:
    def __init__(self):
        self.cur = _FakeCursor()
        self.committed = False

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True


def test_pg():
    print("dag.pg:")
    conn = _FakeConn()
    dag = m.PgDag(conn)

    dag.add_edge("transform", "ingest")
    check(conn.committed, "add_edge commits")
    check("INSERT INTO chain_dependencies" in conn.cur.calls[0][0],
          "add_edge INSERTs the edge")
    check(conn.cur.calls[0][1] == ("transform", "ingest"),
          "add_edge passes (chain_id, depends_on) params")

    conn2 = _FakeConn()
    d2 = m.PgDag(conn2)
    d2.ancestors("report")
    sql = conn2.cur.calls[0][0]
    check(sql == m.ancestors_sql("report"),
          "ancestors() emits the exact recursive-CTE SQL")

    conn3 = _FakeConn()
    d3 = m.PgDag(conn3)
    d3.descendants("ingest")
    check(conn3.cur.calls[0][0] == m.descendants_sql("ingest"),
          "descendants() emits the exact recursive-CTE SQL")

    conn4 = _FakeConn()
    d4 = m.PgDag(conn4)
    d4.topological_levels()
    check(conn4.cur.calls[0][0] == m.topological_levels_sql(),
          "topological_levels() emits the exact recursive-CTE SQL")


if __name__ == "__main__":
    test_ddl()
    test_ancestors_sql()
    test_descendants_sql()
    test_topo_sql()
    test_inmemory()
    test_cycle()
    test_pg()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
