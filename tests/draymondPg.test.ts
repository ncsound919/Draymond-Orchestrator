import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

import {
  enqueue,
  dequeue,
  addEdge,
  ancestors,
  dagLevels,
  recordSample,
  createAggregate,
  queryWindow,
  draymondPg,
} from "../src/lib/draymondPg";

afterEach(() => {
  fetchMock.mockReset();
});

function okJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE = "http://127.0.0.1:8787";

describe("draymondPg client", () => {
  it("enqueues a message with the correct POST body", async () => {
    fetchMock.mockResolvedValue(okJson({ msg_id: "m1" }));
    const r = await enqueue({ chain: "a" });
    expect(r.msg_id).toBe("m1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/queue/enqueue`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ message: { chain: "a" } });
  });

  it("dequeues with batch_size", async () => {
    fetchMock.mockResolvedValue(
      okJson({ items: [{ msg_id: "m1", message: { chain: "a" } }] }),
    );
    const r = await dequeue(2);
    expect(r.items).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/queue/dequeue`);
    expect(JSON.parse(init.body as string)).toEqual({ batch_size: 2 });
  });

  it("adds a DAG edge with chain_id + depends_on", async () => {
    fetchMock.mockResolvedValue(okJson({ added: ["transform", "ingest"] }));
    await addEdge("transform", "ingest");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/dag/edge`);
    expect(JSON.parse(init.body as string)).toEqual({
      chain_id: "transform",
      depends_on: "ingest",
    });
  });

  it("fetches ancestors with the chain query param", async () => {
    fetchMock.mockResolvedValue(
      okJson({ chain: "train", ancestors: [["train", 1], ["transform", 2], ["ingest", 3]] }),
    );
    const r = await ancestors("train");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/dag/ancestors?chain=train`);
    expect(r.ancestors.map((a) => a[0])).toEqual(["train", "transform", "ingest"]);
  });

  it("fetches topological levels via GET", async () => {
    fetchMock.mockResolvedValue(okJson({ levels: { ingest: 1, transform: 2 } }));
    const r = await dagLevels();
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/dag/levels`);
    expect(r.levels).toEqual({ ingest: 1, transform: 2 });
  });

  it("records a telemetry sample and queries the window", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ stored: true }))
      .mockResolvedValueOnce(
        okJson({ rows: [{ bucket: "2025-12-01T00:45:00+00:00", low_count: 5, outlier_detected: true }] }),
      );
    await recordSample("3", "2025-12-01T00:45:00+00:00", 48);
    const r = await queryWindow(
      "2025-12-01T00:45:00+00:00",
      "2025-12-01T00:50:00+00:00",
      "3",
      5,
    );
    expect(r.rows[0].outlier_detected).toBe(true);
    const [sampleUrl, sampleInit] = fetchMock.mock.calls[0];
    expect(String(sampleUrl)).toBe(`${BASE}/ts/sample`);
    expect(JSON.parse(sampleInit.body as string)).toEqual({
      agent_id: "3",
      recorded_at: "2025-12-01T00:45:00+00:00",
      value: 48,
    });
    const [winUrl] = fetchMock.mock.calls[1];
    expect(String(winUrl)).toBe(
      `${BASE}/ts/window?start=2025-12-01T00%3A45%3A00%2B00%3A00&end=2025-12-01T00%3A50%3A00%2B00%3A00&agent=3&flag_threshold=5`,
    );
  });

  it("exposes a named aggregate helper", async () => {
    fetchMock.mockResolvedValue(okJson({ created: true }));
    await createAggregate("5 minutes", 50);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/ts/aggregate`);
    expect(JSON.parse(init.body as string)).toEqual({ bucket: "5 minutes", low_threshold: 50 });
  });

  it("exposes the draymondPg namespace", () => {
    expect(typeof draymondPg.enqueue).toBe("function");
    expect(typeof draymondPg.queryWindow).toBe("function");
  });
});
