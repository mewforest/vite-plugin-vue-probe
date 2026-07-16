// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installProbeAPI } from "../src/client";
import type { ProbeDataSource } from "../src/data-source/types";

afterEach(() => {
  delete window.VUE_PROBE;
});

describe("installProbeAPI", () => {
  it("installs a frozen, idempotent global API", () => {
    const source = {
      init: vi.fn(),
      listApps: () => [],
      getActiveAppId: () => undefined,
      getRevision: () => 0,
      getComponentTree: vi.fn(),
      getComponentState: vi.fn(),
      getPiniaStores: vi.fn(),
      getPiniaState: vi.fn(),
      getComponentRoots: vi.fn(),
    } as unknown as ProbeDataSource;
    const first = installProbeAPI(source);
    const second = installProbeAPI(source);
    expect(first).toBe(second);
    expect(first).toBe(window.VUE_PROBE);
    expect(Object.isFrozen(first)).toBe(true);
    expect(source.init).toHaveBeenCalledOnce();
  });
});
