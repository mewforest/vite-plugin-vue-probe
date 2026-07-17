// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { installProbeAPI, uninstallProbeAPI } from "../src/client";
import type { ProbeDataSource } from "../src/data-source/types";

describe("uninstallProbeAPI non-configurable ownership", () => {
  it("keeps a live installation owned and undisposed when detach fails", () => {
    const source = {
      init: vi.fn(),
      dispose: vi.fn(),
      hasApp: () => true,
      hasPiniaInspector: async () => false,
      listApps: () => [],
      getActiveAppId: () => undefined,
      getRevision: () => 0,
      getComponentTree: vi.fn(),
      getComponentState: vi.fn(),
      getPiniaStores: vi.fn(),
      getPiniaState: vi.fn(),
      getComponentFromElement: vi.fn(),
      getComponentRoots: vi.fn(),
    } as unknown as ProbeDataSource;
    const api = installProbeAPI(source)!;
    Object.defineProperty(window, "VUE_PROBE", {
      value: api,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    expect(uninstallProbeAPI(api)).toBe(false);
    expect(window.VUE_PROBE).toBe(api);
    expect(source.dispose).not.toHaveBeenCalled();
    expect(uninstallProbeAPI(api)).toBe(false);
    expect(source.dispose).not.toHaveBeenCalled();
  });
});
