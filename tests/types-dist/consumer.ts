import vueProbe, {
  type ComponentFromDOMOptions,
  type ComponentFromDOMResult,
  type ComponentDOMOptions,
  type DOMNodeLocator,
  type PiniaStoreSummary,
  type ProbeAPI,
  type ProbeError,
  type DetailedStateResult,
} from "vite-plugin-vue-probe";
import {
  installProbeAPI,
  uninstallProbeAPI,
} from "vite-plugin-vue-probe/client";

const plugin = vueProbe({ enabled: true });
void plugin;

declare const api: ProbeAPI;
declare const options: ComponentDOMOptions;
declare const detailResult: DetailedStateResult;
declare const element: Element;
declare const fromDOMOptions: ComponentFromDOMOptions;

void api.getComponentState("component-1", { bypassBudgets: true });
void api.getDetailedState(
  { kind: "component", componentId: "component-1" },
  ["setup", "rows"],
  { bypassBudgets: true },
);
const paths: string = api.formatters.stateToPaths({ setup: { count: 1 } });
const markdown: string = api.formatters.toMarkdown({ setup: { count: 1 } });
const table: string = api.formatters.domToTable([]);
void api.formatters.treeToMermaid({
  appId: "app-1",
  rootId: "root",
  format: "flat",
  nodes: [],
  truncatedByDepth: false,
});
void api.formatters.toCleanJson({ value: 1 });
void paths;
void markdown;
void table;

void api.getComponentDOM("component-1", {
  appId: "app-1",
  expectedRevision: 4,
});
void api.getComponentDOM("component-1", options);
void api.getComponentFromDOM("#user-card", fromDOMOptions);
void api.getComponentFromDOM(element, {
  appId: "app-1",
  expectedRevision: 4,
});
const identity: ComponentFromDOMResult = {
  appId: "app-1",
  componentId: "app-1:1",
  name: "UserCard",
};
void identity;
void api.getPiniaStores({ appId: "app-1", includeKeys: true });
const resolvedAppId: string = detailResult.target.appId;
void resolvedAppId;

const storeWithoutKeys: PiniaStoreSummary = {
  appId: "app-1",
  id: "users",
};
const storeWithKeys: PiniaStoreSummary = {
  ...storeWithoutKeys,
  stateKeys: ["users"],
  getterKeys: ["count"],
};
void storeWithKeys;

const locator: DOMNodeLocator = {
  index: 0,
  selector: "[data-testid=save]",
  shadowHostSelectors: ["#shell", "#dialog"],
  tag: "button",
  rect: {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    top: 0,
    right: 10,
    bottom: 10,
    left: 0,
  },
  connected: true,
};
void locator;

const installed = installProbeAPI();
if (installed) uninstallProbeAPI(installed);

// @ts-expect-error Component DOM revisions must be safe integers at runtime,
// and the declaration must at least reject non-number values.
void api.getComponentDOM("component-1", { expectedRevision: "4" });

// @ts-expect-error DOM lookup does not accept arbitrary objects.
void api.getComponentFromDOM({}, {});

// @ts-expect-error Pinia key enrichment is controlled by a boolean.
void api.getPiniaStores({ includeKeys: "yes" });

const errorWithDetails: ProbeError = {
  code: "INTERNAL_ERROR",
  message: "failed",
  // @ts-expect-error Probe errors intentionally expose only code and message.
  details: { operation: "read" },
};
void errorWithDetails;

const storeWithConsumers: PiniaStoreSummary = {
  appId: "app-1",
  id: "users",
  // @ts-expect-error Store usage inference is not part of the public contract.
  usedByComponentIds: ["component-1"],
};
void storeWithConsumers;
