#!/usr/bin/env python3
"""Overlay365 graphify launcher — runs graphify's MCP server with a /health route.

Graphify's Streamable HTTP endpoint (/mcp) returns 406 to a plain GET because,
per the MCP spec, GET /mcp is the SSE-stream handshake and always requires
`Accept: text/event-stream` — even in --json-response mode. Uptime probes,
browsers, and simple health checks therefore see "Not Acceptable: Client must
accept text/event-stream".

This wrapper builds graphify's exact ASGI app (same tools, same /mcp endpoint,
same JSON-response/stateless options) and adds a `/health` route returning
200 JSON with graph stats, so a plain GET can always probe liveness.

Usage (mirrors `python -m graphify.serve`):
  python scripts/serve-graphify.py graphify-out/graph.json \
      --transport http --port 3203 --host 127.0.0.1 --json-response --stateless
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from graphify.serve import _build_http_app, _default_graph_json


def build_app(graph_path: str, *, host: str, port: int, api_key: str | None,
              path: str, json_response: bool, stateless: bool,
              session_timeout: float | None):
    app = _build_http_app(
        graph_path,
        host=host,
        port=port,
        api_key=api_key,
        path=path,
        json_response=json_response,
        stateless=stateless,
        session_timeout=session_timeout,
    )

    # Add a plain-GET health route that reports graph liveness.
    async def health(request):
        from starlette.responses import JSONResponse

        stats = {}
        try:
            with open(graph_path, "r", encoding="utf-8") as fh:
                g = json.load(fh)
            stats = {
                "indexed": True,
                "nodes": len(g.get("nodes", [])),
                "edges": len(g.get("links", [])) + len(g.get("edges", [])),
                "graph_file": os.path.basename(graph_path),
            }
        except Exception as exc:  # noqa: BLE001
            stats = {"indexed": False, "error": str(exc)}
        return JSONResponse(
            {"ok": True, "service": "graphify", "mcp_path": path, **stats},
            status_code=200,
        )

    # Starlette apps expose add_route; the Route list is also inspectable.
    if hasattr(app, "add_route"):
        app.add_route("/health", health, methods=["GET"])
    else:
        from starlette.routing import Route

        # Fallback: rebuild routes including health. Keep the MCP route first.
        from graphify.serve import _MCPASGIApp  # noqa: F401

        new_routes = list(app.routes)
        new_routes.append(Route("/health", endpoint=health, methods=["GET"]))
        app.routes = new_routes
    return app


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="serve-graphify", description=__doc__)
    parser.add_argument("graph_path", nargs="?", default=None)
    parser.add_argument("--graph", dest="graph_flag", default=None)
    parser.add_argument("--transport", choices=["stdio", "http"], default="http")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3203)
    parser.add_argument("--api-key", default=os.environ.get("GRAPHIFY_API_KEY"))
    parser.add_argument("--path", default="/mcp")
    parser.add_argument("--json-response", action="store_true")
    parser.add_argument("--stateless", action="store_true")
    parser.add_argument("--session-timeout", type=float, default=3600.0)
    args = parser.parse_args(argv)

    graph_path = args.graph_flag or args.graph_path or _default_graph_json()

    if args.transport == "http":
        import uvicorn

        app = build_app(
            graph_path,
            host=args.host,
            port=args.port,
            api_key=args.api_key,
            path=args.path,
            json_response=args.json_response,
            stateless=args.stateless,
            session_timeout=args.session_timeout,
        )
        auth_note = "api-key required" if args.api_key else "no auth"
        print(
            f"graphify (overlay wrapper) MCP on http://{args.host}:{args.port}{args.path} "
            f"- {auth_note} - health: http://{args.host}:{args.port}/health",
            file=sys.stderr,
        )
        uvicorn.run(app, host=args.host, port=args.port)
    else:
        from graphify.serve import serve

        serve(graph_path)


if __name__ == "__main__":
    main()
