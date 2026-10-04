import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-context";
import { SessionQueryProvider } from "./session-query-provider";
import { useCurveReview } from "./hooks/use-curve-review";
import { jobQueryKey } from "./hooks/use-digitization-job";
import { ApiError } from "./services/http-client";
import { endAccountSession, getSessionScope } from "./services/session-scope";
import { setSession } from "./services/token-store";
import { segmentJob } from "./test-fixtures/collection-fixtures";
import type { User } from "./models/auth-models";
import type { JobSummary } from "./models/digitization-models";

const gateway = vi.hoisted(() => ({ restore: vi.fn(), login: vi.fn(), logout: vi.fn(), getJob: vi.fn(), getCurve: vi.fn(), setEdits: vi.fn() }));
vi.mock("./services/auth-service", () => ({ authGateway: gateway }));
vi.mock("./services/digitization-service", () => ({ digitizationGateway: gateway }));
let auth: ReturnType<typeof useAuth>;
let client: QueryClient;
function Controls() { auth = useAuth(); return null; }
function Content() {
  const { user } = useAuth(); client = useQueryClient();
  const query = useQuery({ queryKey: jobQueryKey("private-job"), queryFn: () => gateway.getJob(user!.user_id), enabled: !!user });
  const review = useCurveReview(query.data as JobSummary ?? null);
  return <output data-testid="trace">{review.x.join(",")}</output>;
}
const user = (id: string) => ({ user_id: id, email: id }) as User;

describe("authenticated query root isolation", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    endAccountSession();
    gateway.restore.mockResolvedValue(null); gateway.logout.mockResolvedValue(undefined);
    gateway.login.mockImplementation(async ({ email }: { email: string }) => user(email));
    gateway.getJob.mockImplementation(async (id: string) => {
      if (id === "b") throw new ApiError(404, "Not found");
      return segmentJob("private-job");
    });
    gateway.getCurve.mockResolvedValue({ x: [11, 22, 33], observed: [true, true, true] });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<StrictMode><AuthProvider><Controls /><SessionQueryProvider><Content /></SessionQueryProvider></AuthProvider></StrictMode>));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  async function login(id: string) {
    await act(async () => { await auth.login({ email: id, password: "fixture" }); });
  }
  async function waitForState(assertion: () => void) {
    const deadline = Date.now() + 2000;
    for (;;) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      try { assertion(); return; }
      catch (error) { if (Date.now() >= deadline) throw error; }
    }
  }
  async function waitForTrace(expected: string) {
    await waitForState(() => expect(host.querySelector("output")!.textContent).toBe(expected));
  }
  async function waitForRejectedJob() {
    await waitForState(() => expect(client.getQueryState(jobQueryKey("private-job"))?.status).toBe("error"));
  }

  it("never displays A's trace under B even when B's GET fails, and refresh retains the same root", async () => {
    await login("a");
    await waitForTrace("11,22,33");
    const first = client, scope = getSessionScope();
    expect(host.querySelector("output")!.textContent).toBe("11,22,33");
    await act(async () => setSession({ access_token: "fixture", refresh_token: "fixture", media_token: "fixture" }));
    expect(client).toBe(first); expect(getSessionScope()).toBe(scope);
    await act(async () => { await auth.logout(); }); await login("b");
    await waitForRejectedJob();
    expect(client).not.toBe(first);
    expect(host.querySelector("output")!.textContent).toBe("");
    expect(client.getQueryData(jobQueryKey("private-job"))).toBeUndefined();
    expect(gateway.getCurve).toHaveBeenCalledTimes(1);
    await act(async () => { await auth.logout(); }); await login("a");
    await waitForTrace("11,22,33");
    expect(client).not.toBe(first); expect(host.querySelector("output")!.textContent).toBe("11,22,33");
  });

  it("does not publish A's late job response into B's client", async () => {
    let finish!: (value: JobSummary) => void;
    gateway.getJob.mockImplementation((id: string) => id === "a"
      ? new Promise(resolve => { finish = resolve; }) : Promise.reject(new ApiError(403, "Forbidden")));
    await login("a"); const first = client;
    await waitForState(() => expect(finish).toBeTypeOf("function"));
    await act(async () => { await auth.logout(); }); await login("b");
    await waitForRejectedJob();
    const second = client;
    await act(async () => finish(segmentJob("private-job")));
    expect(second).not.toBe(first); expect(client).toBe(second);
    expect(second.getQueryData(jobQueryKey("private-job"))).toBeUndefined();
    expect(host.querySelector("output")!.textContent).toBe(""); expect(gateway.getCurve).not.toHaveBeenCalled();
  });
});
