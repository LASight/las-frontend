import { describe, expect, it } from "vitest";

import { HttpDigitizationGateway } from "./digitization-service";

/**
 * The tile URL is a wire contract, and it has already broken once silently.
 *
 * The crop step asks for a tile squashed on one axis only. FastAPI ignores
 * query parameters its signature does not declare, so a rename on either side
 * does not fail — the server just returns the full-resolution raster and the
 * browser crushes it, which looks like an image-decoding fault rather than a
 * dropped parameter. These tests pin the parameter names the backend declares.
 */
describe("HttpDigitizationGateway.tileUrl", () => {
  const gateway = new HttpDigitizationGateway();

  function params(url: string): URLSearchParams {
    return new URL(url, "http://localhost").searchParams;
  }

  it("sends the per-axis scales under the names the backend declares", () => {
    const query = params(
      gateway.tileUrl("job-1", { y0: 0, y1: 55150, scaleX: 0.55, scaleY: 0.0076 })
    );
    expect(query.get("scale_x")).toBe("0.5500");
    expect(query.get("scale_y")).toBe("0.0076");
  });

  it("omits a scale that was not asked for, so the backend default applies", () => {
    const query = params(gateway.tileUrl("job-1", { y0: 0, y1: 1024 }));
    expect(query.has("scale")).toBe(false);
    expect(query.has("scale_x")).toBe(false);
    expect(query.has("scale_y")).toBe(false);
  });

  it("keeps the uniform scale the review canvas uses", () => {
    const query = params(gateway.tileUrl("job-1", { y0: 0, y1: 1024, scale: 0.25 }));
    expect(query.get("scale")).toBe("0.2500");
  });

  it("sends whole-pixel window bounds", () => {
    const query = params(
      gateway.tileUrl("job-1", { y0: 10.7, y1: 20.2, x0: 5.9, x1: 30.1 })
    );
    expect(query.get("y0")).toBe("10");
    expect(query.get("y1")).toBe("21");
    expect(query.get("x0")).toBe("5");
    expect(query.get("x1")).toBe("31");
  });
});
