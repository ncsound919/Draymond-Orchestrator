# Music Rights & Book Library Integration

## BookBridge (book ingestion)

BookBridge (`agents/BookBridge--main`) serves the book library over REST
(`:8777`) and MCP (`:8778`). It now **auto-scans the library folders and
ingests new books**, so you can keep dropping books in.

**Library folders scanned** (override with `BOOKBRIDGE_LIBRARY_DIRS`, OS path-sep
separated, absolute paths):

- `agents/AgentBrowser-main/data/books`
- `docs/knowledge/books`

**Run it** (from `agents/BookBridge--main`):

```bash
python -m pip install -r requirements.txt
python main.py --watch        # HTTP :8777 + MCP :8778 + auto-ingest watcher
```

The `--watch` flag rescans the folders every 300s (`BOOKBRIDGE_WATCH_INTERVAL`)
and indexes new `.pdf`/`.epub`/`.txt`/`.md` files automatically.

**API:**

- `GET  /library/dirs` — show configured library folders
- `POST /scan` — manually trigger a scan (`{"force": true}` re-indexes all)
- `POST /books/add` — add a single file
- `POST /search`, `/retrieve`, `/citation`, `/reading_plan`, `/graph/related` — query the library

Progress is visible in `~/.bookbridge/bookbridge.db` and the `/health` endpoint
(`books_indexed`, `chunks_indexed`).

## Music rights (ASCAP / HFA / MLC)

Draymond now has a registration API that wraps the AgentBrowser music-rights
scripts (`agents/AgentBrowser-main/mini-services/music-rights/`: `ascap-extract.ts`,
`hfa-upload.ts`, `mlc-extract.ts`).

**Register a catalog** (requires the admin `CRON_SECRET`):

```bash
curl -X POST http://localhost:3444/api/music/register \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "org": "hfa",
    "email": "you@gmail.com",
    "password": "ASCAP/HFA/MLC password",
    "publisher_name": "Your Publishing Co",
    "publisher_ipi": "…",
    "songs": [
      { "title": "Song Title", "artist": "Artist", "isrc": "US-…",
        "writers": [ { "name": "Writer", "ipi": "…" } ] }
    ]
  }'
```

- `org`: `ascap` | `hfa` | `mlc`
- Without `email`/`password` the catalog is **staged** (saved, not submitted).
- Records persist to `.draymond/music-registrations.json`.

**List registrations:**

```bash
curl http://localhost:3444/api/music/registrations \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Agent:** `agent-browser` (The Conductor) owns the `music-rights` skill and is
the natural controller for this flow.
