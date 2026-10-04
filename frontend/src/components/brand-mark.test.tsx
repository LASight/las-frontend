import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthLayout } from "./auth/auth-layout";
import { BrandMark } from "./brand-mark";
import { Sidebar } from "./sidebar";

vi.mock("../auth-context", () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));

let host: HTMLDivElement, root: Root;
describe("selective shared branding; no workflow redesign", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it("names the standalone logo and accepts caller dimensions through its class", async () => {
    await act(async () => root.render(<BrandMark className="caller-size" />));
    expect(host.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("WellSight");
    expect(host.firstElementChild!.classList.contains("caller-size")).toBe(true);
  });
  it("hides the decorative mark instead of repeating the visible wordmark", async () => {
    await act(async () => root.render(<div><BrandMark decorative /><span>WellSight</span></div>));
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(host.querySelector('[aria-label="WellSight"]')).toBeNull();
    expect(host.textContent).toBe("WellSight");
  });
  it("retains the centered auth structure, form children and footer without promotional copy", async () => {
    await act(async () => root.render(<AuthLayout title="Sign in" subtitle="Access your workspace." footer={<a href="/signup">Create account</a>}>
      <form><label>Email<input type="email" /></label><label>Password<input type="password" /></label><button>Sign in</button></form>
    </AuthLayout>));
    expect(host.querySelectorAll("main")).toHaveLength(1); expect(host.querySelector("aside")).toBeNull();
    expect(host.querySelector("h1")!.textContent).toBe("Sign in");
    expect(host.querySelectorAll("input")).toHaveLength(2); expect(host.querySelector('a[href="/signup"]')).not.toBeNull();
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(host.textContent).not.toContain("reservoir-ready");
  });
  it("preserves Compare wells, workspace labeling and the sidebar toggle", async () => {
    const toggle = vi.fn();
    await act(async () => root.render(<MemoryRouter initialEntries={["/portfolio"]}><Sidebar collapsed={false} onCollapseToggle={toggle} status="Ready." isBusy={false} /></MemoryRouter>));
    expect(host.querySelector('nav[aria-label="Workspaces"]')).not.toBeNull();
    const comparison = host.querySelector<HTMLAnchorElement>('a[href="/portfolio"]')!;
    expect(comparison.textContent).toContain("Compare wells"); expect(comparison.getAttribute("aria-current")).toBe("page");
    expect(host.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1);
    await act(async () => (host.querySelector('[aria-label="Collapse sidebar"]') as HTMLButtonElement).click());
    expect(toggle).toHaveBeenCalledOnce();
  });
});
