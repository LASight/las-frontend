import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURVE_METADATA } from "../../controllers/curve-metadata-controller";
import { MetadataCombobox } from "./metadata-combobox";
let host: HTMLDivElement, root: Root;
const changes = vi.fn();
function Field({ initial = "", disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <><MetadataCombobox id="test-code" label="Curve mnemonic" value={value} disabled={disabled} choices={CURVE_METADATA} onChange={(next) => { changes(next); setValue(next); }} /><button>Outside</button></>;
}
async function render(props = {}) { await act(async () => root.render(<Field {...props} />)); }
async function type(value: string) {
  const input = host.querySelector("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
describe("searchable custom-capable metadata combobox", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); changes.mockClear();
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  it("starts blank and accepts an option only when the operator selects it", async () => {
    await render(); await act(async () => host.querySelector("input")!.focus());
    expect(changes).not.toHaveBeenCalled();
    const option = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((element) => element.textContent?.includes("Gamma ray"))!;
    await act(async () => option.click()); expect(host.querySelector("input")!.value).toBe("GR");
    expect(changes).toHaveBeenCalledWith("GR");
  });
  it("filters readable names and provides keyboard selection", async () => {
    await render(); await type("density");
    expect(host.querySelector('[role="listbox"]')!.textContent).toContain("Bulk density");
    expect(host.querySelector('[role="listbox"]')!.textContent).not.toContain("Gamma ray");
    await act(async () => host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(host.querySelector("input")!.value).toBe("RHOB");
  });
  it("preserves exact custom aliases/case and never normalizes on blur or escape", async () => {
    await render({ initial: "Gr_archived" });
    await act(async () => host.querySelector("input")!.focus());
    await act(async () => host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(changes).not.toHaveBeenCalled(); expect(host.querySelector("input")!.value).toBe("Gr_archived");
    await type("Vendor_code"); expect(host.querySelector('[role="listbox"]')!.textContent).toContain("Other / custom");
    await act(async () => host.querySelector<HTMLButtonElement>("button:last-child")!.focus());
    expect(host.querySelector("input")!.value).toBe("Vendor_code"); expect(changes).toHaveBeenLastCalledWith("Vendor_code");
  });
  it("exposes a labelled accessible combobox and no options while disabled", async () => {
    await render({ disabled: true });
    const input = host.querySelector("input")!;
    expect(input.getAttribute("role")).toBe("combobox"); expect(input.getAttribute("aria-label")).toBe("Curve mnemonic");
    expect(input.disabled).toBe(true); expect(host.querySelector('[role="listbox"]')).toBeNull(); expect(changes).not.toHaveBeenCalled();
  });
});
