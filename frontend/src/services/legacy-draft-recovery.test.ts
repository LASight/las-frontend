import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE } from "./http-client";
import { hasLegacyDraft, recoverLegacyDraft } from "./legacy-draft-recovery";
import { accountDraftKey, endAccountSession, setSessionAccount } from "./session-scope";

describe("explicit authorized legacy draft recovery", () => {
  const legacy = `digitization-input-draft:${API_BASE}:job`;
  const raw = JSON.stringify({ fixture: "A's older draft" });
  beforeEach(() => { localStorage.clear(); endAccountSession(); setSessionAccount("a"); localStorage.setItem(legacy, raw); });

  it("copies only after successful fresh access verification and retains the original", async () => {
    const verify = vi.fn(async () => { expect(localStorage.getItem(accountDraftKey("input", API_BASE, "job")!)).toBeNull(); });
    expect(hasLegacyDraft("input", "job")).toBe(true);
    await expect(recoverLegacyDraft("input", "job", verify, () => true)).resolves.toBe(raw);
    expect(localStorage.getItem(legacy)).toBe(raw);
    expect(localStorage.getItem(accountDraftKey("input", API_BASE, "job")!)).toBe(raw);
  });

  it("does not read/copy old data for B when fresh server authorization fails", async () => {
    endAccountSession(); setSessionAccount("b");
    await expect(recoverLegacyDraft("input", "job", async () => { throw new Error("Forbidden"); }, () => true)).rejects.toThrow("Forbidden");
    expect(localStorage.getItem(accountDraftKey("input", API_BASE, "job")!)).toBeNull(); expect(localStorage.getItem(legacy)).toBe(raw);
  });

  it("leaves both drafts unchanged if an owned draft exists", async () => {
    const key = accountDraftKey("input", API_BASE, "job")!;
    localStorage.setItem(key, "owned");
    await expect(recoverLegacyDraft("input", "job", async () => undefined, () => true)).rejects.toThrow("already exists");
    expect(localStorage.getItem(key)).toBe("owned"); expect(localStorage.getItem(legacy)).toBe(raw);
  });

  it("does not copy a late verification result after account switch", async () => {
    let finish!: () => void;
    const pending = recoverLegacyDraft("input", "job", () => new Promise<void>(resolve => { finish = resolve; }), () => true);
    endAccountSession(); setSessionAccount("b"); finish();
    await expect(pending).rejects.toThrow("Session changed");
    expect(localStorage.getItem(accountDraftKey("input", API_BASE, "job")!)).toBeNull(); expect(localStorage.getItem(legacy)).toBe(raw);
  });
});
