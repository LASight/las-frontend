import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe("explicit same-origin API base for opt-in local proxy", () => {
  it("preserves an empty configured base rather than falling back to port 8000", async () => {
    vi.stubEnv("VITE_API_BASE_URL", ""); vi.resetModules();
    expect((await import("./http-client")).API_BASE).toBe("");
  });
  it("preserves a nonempty configured base", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8003"); vi.resetModules();
    expect((await import("./http-client")).API_BASE).toBe("http://127.0.0.1:8003");
  });
});
