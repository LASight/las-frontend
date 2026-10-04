import { describe, expect, it, vi } from "vitest";
import { collectionFixture, segmentJob } from "../test-fixtures/collection-fixtures";
import type { JobSummary } from "../models/digitization-models";
import { canProcess, identityIssue, processCurveQueue } from "./curve-queue-controller";

describe("sequential unified curve queue", () => {
  it("starts two calibrated members sequentially and publishes real per-member progress", async () => {
    const collection = collectionFixture();
    collection.segments.forEach(({ job }) => { job.quality = null; job.phase = "calibrating"; });
    const states = new Map(collection.segments.map(({ job }) => [job.job_id, structuredClone(job)]));
    const events: string[] = [];
    const gateway = {
      getJob: vi.fn(async (id: string) => structuredClone(states.get(id)!)),
      startSegmentation: vi.fn(async (id: string) => {
        expect([...states.values()].some((job) => job.phase === "segmenting")).toBe(false);
        events.push(`start:${id}`);
        const job = { ...states.get(id)!, phase: "segmenting" as const, progress: { windows_done: 0, windows_total: 2, message: "fixture" } };
        states.set(id, job); return structuredClone(job);
      }),
    };
    await processCurveQueue(collection, gateway, (job) => events.push(`state:${job.job_id}:${job.progress?.windows_done ?? "ready"}`), async () => {
      const job = [...states.values()].find((item) => item.phase === "segmenting")!;
      job.progress!.windows_done++;
      if (job.progress!.windows_done === 2) { job.phase = "reviewing"; job.quality = segmentJob(job.job_id).quality; events.push(`done:${job.job_id}`); }
    }, new AbortController().signal);
    expect(gateway.startSegmentation.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
    expect(events.indexOf("done:first")).toBeLessThan(events.indexOf("start:second"));
    expect(events).toContain("state:first:1"); expect(events).toContain("state:second:1");
  });
  it("preserves READY predictions/corrections and skips members lacking crop or calibration", async () => {
    const collection = collectionFixture();
    collection.segments[0].job.edits = [{ kind: "discard", y0: 0, y1: 1 }];
    collection.segments[1].job.quality = null;
    collection.segments[1].job.calibration = null;
    const gateway = { getJob: vi.fn(async (id: string) => collection.segments.find((s) => s.job_id === id)!.job), startSegmentation: vi.fn() };
    await processCurveQueue(collection, gateway, vi.fn(), vi.fn(), new AbortController().signal);
    expect(gateway.startSegmentation).not.toHaveBeenCalled();
    expect(collection.segments[0].job.edits).toHaveLength(1);
    expect(canProcess({ ...segmentJob("x"), quality: null, crop: null })).toBe(false);
  });
  it("stops visibly on failure without starting later members; explicit retry skips successful ones", async () => {
    const collection = collectionFixture();
    collection.segments.forEach(({ job }) => { job.quality = null; job.phase = "calibrating"; });
    const gateway = { getJob: vi.fn(async (id: string) => collection.segments.find((s) => s.job_id === id)!.job),
      startSegmentation: vi.fn(async (id: string): Promise<JobSummary> => ({ ...collection.segments.find((s) => s.job_id === id)!.job, phase: "failed" as const, error: "GPU unavailable" })) };
    await expect(processCurveQueue(collection, gateway, vi.fn(), vi.fn(), new AbortController().signal)).rejects.toThrow("First segment: GPU unavailable");
    expect(gateway.startSegmentation.mock.calls.map(([id]) => id)).toEqual(["first"]);
    collection.segments[0].job = segmentJob("first");
    gateway.startSegmentation.mockResolvedValueOnce(segmentJob("second"));
    await processCurveQueue(collection, gateway, vi.fn(), vi.fn(), new AbortController().signal);
    expect(gateway.startSegmentation.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
  });
  it("rejoins a cold running member before starting any pending member", async () => {
    const collection = collectionFixture();
    collection.segments[0].job.quality = null; collection.segments[0].job.phase = "calibrating";
    collection.segments[1].job.quality = null; collection.segments[1].job.phase = "segmenting";
    const events: string[] = [];
    const gateway = { getJob: vi.fn(async (id: string) => collection.segments.find((s) => s.job_id === id)!.job), startSegmentation: vi.fn(async (id: string) => { events.push(id); return segmentJob(id); }) };
    await processCurveQueue(collection, gateway, vi.fn(), async () => { collection.segments[1].job = segmentJob("second"); events.push("rejoined"); }, new AbortController().signal);
    expect(events).toEqual(["rejoined", "first"]);
  });
  it("rejects mismatched identity without silently replacing mnemonic or units", async () => {
    const collection = collectionFixture(); collection.segments[1].job.calibration!.mnemonic = "SP";
    const gateway = { getJob: vi.fn(), startSegmentation: vi.fn() };
    expect(identityIssue(collection)).toContain("must match");
    await expect(processCurveQueue(collection, gateway, vi.fn(), vi.fn(), new AbortController().signal)).rejects.toThrow("must match");
    expect(gateway.getJob).not.toHaveBeenCalled(); expect(collection.segments[1].job.calibration!.mnemonic).toBe("SP");
  });
  it("does not start another task after unmount/cancellation", async () => {
    const abort = new AbortController(); abort.abort();
    const gateway = { getJob: vi.fn(), startSegmentation: vi.fn() };
    await processCurveQueue(collectionFixture(), gateway, vi.fn(), vi.fn(), abort.signal);
    expect(gateway.getJob).not.toHaveBeenCalled();
  });
});
