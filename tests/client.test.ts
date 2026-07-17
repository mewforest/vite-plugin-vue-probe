// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installProbeAPI, uninstallProbeAPI } from "../src/client";
import type { ProbeDataSource } from "../src/data-source/types";

afterEach(() => {
  uninstallProbeAPI();
  delete window.VUE_PROBE;
});

function sourceFixture(): ProbeDataSource {
  return {
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
}

describe("installProbeAPI", () => {
  it("installs a frozen, idempotent global API", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const source = sourceFixture();
    const first = installProbeAPI(source);
    const second = installProbeAPI(source);
    expect(first).toBe(second);
    expect(first).toBe(window.VUE_PROBE);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first!.formatters)).toBe(true);
    expect(first!.formatters.stateToPaths({ setup: { count: 1 } })).toBe(
      "setup.count = 1",
    );
    expect(source.init).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[0]).toMatch(
      /^🔍 vite-plugin-vue-probe: window\.VUE_PROBE ready \(API /,
    );
    info.mockRestore();
  });

  it("disposes an owned installation once and supports reinstall", () => {
    const firstSource = sourceFixture();
    const first = installProbeAPI(firstSource)!;

    expect(uninstallProbeAPI(first)).toBe(true);
    expect(window.VUE_PROBE).toBeUndefined();
    expect(firstSource.dispose).toHaveBeenCalledOnce();
    expect(uninstallProbeAPI(first)).toBe(false);
    expect(firstSource.dispose).toHaveBeenCalledOnce();

    const secondSource = sourceFixture();
    const second = installProbeAPI(secondSource)!;
    expect(second).not.toBe(first);
    expect(secondSource.init).toHaveBeenCalledOnce();
  });

  it("does not remove a replacement global while disposing its owned source", () => {
    const source = sourceFixture();
    const owned = installProbeAPI(source)!;
    delete window.VUE_PROBE;
    const replacement = { version: "foreign" } as unknown as typeof owned;
    window.VUE_PROBE = replacement;

    expect(uninstallProbeAPI(owned)).toBe(true);
    expect(window.VUE_PROBE).toBe(replacement);
    expect(source.dispose).toHaveBeenCalledOnce();
  });

  it("does not claim or dispose a pre-existing foreign API", () => {
    const foreign = { version: "foreign" } as unknown as NonNullable<
      typeof window.VUE_PROBE
    >;
    window.VUE_PROBE = foreign;
    const source = sourceFixture();

    expect(installProbeAPI(source)).toBe(foreign);
    expect(source.init).not.toHaveBeenCalled();
    expect(uninstallProbeAPI(foreign)).toBe(false);
    expect(window.VUE_PROBE).toBe(foreign);
    expect(source.dispose).not.toHaveBeenCalled();
  });

  it("disposes a source when initialization fails and preserves the primary error", () => {
    const source = sourceFixture();
    vi.mocked(source.init).mockImplementation(() => {
      throw new Error("initialization failed");
    });
    vi.mocked(source.dispose!).mockImplementation(() => {
      throw new Error("cleanup failed");
    });

    expect(() => installProbeAPI(source)).toThrow("initialization failed");
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(window.VUE_PROBE).toBeUndefined();
  });
});
