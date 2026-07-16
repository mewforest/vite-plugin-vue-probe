import type { ProbeAPI } from "./public-types";
import type { ProbeDataSource } from "./data-source/types";
import { DevtoolsDataSource } from "./data-source/devtools";
import { createProbeAPI } from "./core/facade";

export function installProbeAPI(
  source: ProbeDataSource = new DevtoolsDataSource(),
): ProbeAPI | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.VUE_PROBE) return window.VUE_PROBE;
  source.init();
  const api = Object.freeze(createProbeAPI(source));
  Object.defineProperty(window, "VUE_PROBE", {
    value: api,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return api;
}

export type * from "./public-types";
