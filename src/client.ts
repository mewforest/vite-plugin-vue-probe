import type { ProbeAPI } from "./public-types.js";
import type { ProbeDataSource } from "./data-source/types.js";
import { DevtoolsDataSource } from "./data-source/devtools.js";
import { createProbeAPI } from "./core/facade.js";

interface OwnedInstallation {
  readonly source: ProbeDataSource;
}

const installations = new WeakMap<ProbeAPI, OwnedInstallation>();

export function installProbeAPI(
  source: ProbeDataSource = new DevtoolsDataSource(),
): ProbeAPI | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.VUE_PROBE) return window.VUE_PROBE;
  let initializationAttempted = false;
  try {
    initializationAttempted = true;
    source.init();
    const api = Object.freeze(createProbeAPI(source));
    Object.defineProperty(window, "VUE_PROBE", {
      value: api,
      configurable: true,
      enumerable: false,
      writable: false,
    });
    installations.set(api, { source });
    return api;
  } catch (error) {
    if (initializationAttempted) {
      try {
        source.dispose?.();
      } catch {
        // Preserve the primary transaction failure after cleanup is attempted.
      }
    }
    throw error;
  }
}

export function uninstallProbeAPI(api?: ProbeAPI): boolean {
  if (typeof window === "undefined") return false;
  const candidate = api ?? window.VUE_PROBE;
  if (!candidate) return false;
  const installation = installations.get(candidate);
  if (!installation) return false;
  if (window.VUE_PROBE === candidate) {
    try {
      if (!Reflect.deleteProperty(window, "VUE_PROBE")) return false;
    } catch {
      return false;
    }
  }
  installations.delete(candidate);
  installation.source.dispose?.();
  return true;
}

export type * from "./public-types.js";
