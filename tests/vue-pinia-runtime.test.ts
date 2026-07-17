// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  Fragment,
  KeepAlive,
  Suspense,
  Teleport,
  computed,
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
  reactive,
  type App,
  type Component,
} from "vue";
import { createPinia, defineStore, setActivePinia } from "pinia";
import { createProbeAPI } from "../src/core/facade";
import { collectComponentRootElements } from "../src/data-source/devtools";
import type { ProbeDataSource, RawPiniaState } from "../src/data-source/types";

interface MountedFixture {
  app: App;
  container: HTMLElement;
  subTree(): unknown;
}

const mounted: MountedFixture[] = [];

function mount(component: Component, id: string): MountedFixture {
  const container = document.createElement("div");
  container.id = id;
  document.body.append(container);
  const app = createApp(component);
  app.mount(container);
  const fixture: MountedFixture = {
    app,
    container,
    subTree: () =>
      (app as unknown as { _instance?: { subTree?: unknown } })._instance
        ?.subTree,
  };
  mounted.push(fixture);
  return fixture;
}

afterEach(() => {
  while (mounted.length > 0) {
    const fixture = mounted.pop()!;
    fixture.app.unmount();
    fixture.container.remove();
  }
  document.body.innerHTML = "";
});

describe("real Vue and Pinia runtime fixtures", () => {
  it("serializes real Options API and setup state through the facade", async () => {
    const fixture = mount(
      defineComponent({
        data: () => ({ count: 2 }),
        computed: {
          doubled(): number {
            return this.count * 2;
          },
        },
        setup() {
          const page = ref(3);
          const filters = reactive({ active: true });
          const summary = computed(() => `${page.value}:${filters.active}`);
          return { page, filters, summary };
        },
        render() {
          return h("div", `${this.doubled}:${this.summary}`);
        },
      }),
      "component-state-runtime",
    );
    await nextTick();
    const instance = (
      fixture.app as unknown as {
        _instance: {
          data: Record<string, unknown>;
          setupState: Record<string, unknown>;
          proxy: Record<string, unknown>;
        };
      }
    )._instance;
    const api = createProbeAPI(
      runtimeSource({
        getComponentState: async (appId, componentId) => ({
          appId,
          componentId,
          name: "RuntimeState",
          state: {
            data: { count: instance.data.count },
            computed: { doubled: instance.proxy.doubled },
            setup: {
              page: instance.setupState.page,
              filters: instance.setupState.filters,
              summary: instance.setupState.summary,
            },
          },
        }),
      }),
    );

    await expect(
      api.getComponentState("root", { appId: "app-a", maxDepth: 3 }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: {
          data: { count: 2 },
          computed: { doubled: 4 },
          setup: {
            page: 3,
            filters: { active: true },
            summary: "3:true",
          },
        },
      },
    });
  });

  it("extracts real Fragment, Teleport, and KeepAlive roots", async () => {
    const teleportTarget = document.createElement("aside");
    teleportTarget.id = "teleport-target";
    document.body.append(teleportTarget);
    const Child = defineComponent({
      name: "KeptChild",
      render: () => h("article", { "data-testid": "kept" }, "kept"),
    });
    const fixture = mount(
      defineComponent({
        render() {
          return h(Fragment, null, [
            h("button", { "data-testid": "first" }, "first"),
            h(Teleport, { to: teleportTarget }, [
              h("dialog", { "data-testid": "teleported" }, "teleported"),
            ]),
            h(KeepAlive, null, { default: () => h(Child) }),
          ]);
        },
      }),
      "vue-branches",
    );
    await nextTick();

    expect(
      collectComponentRootElements(fixture.subTree()).map((element) =>
        element.getAttribute("data-testid"),
      ),
    ).toEqual(["first", "teleported", "kept"]);
  });

  it("tracks both fallback and resolved real Suspense branches", async () => {
    let resolveSetup!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveSetup = resolve;
    });
    const AsyncChild = defineComponent({
      name: "AsyncChild",
      async setup() {
        await ready;
        return () => h("main", { "data-testid": "resolved" }, "resolved");
      },
    });
    const fixture = mount(
      defineComponent({
        render: () =>
          h(Suspense, null, {
            default: () => h(AsyncChild),
            fallback: () =>
              h("span", { "data-testid": "fallback" }, "loading"),
          }),
      }),
      "vue-suspense",
    );
    await nextTick();

    expect(
      collectComponentRootElements(fixture.subTree()).map((element) =>
        element.getAttribute("data-testid"),
      ),
    ).toContain("fallback");

    resolveSetup();
    await ready;
    await nextTick();
    await nextTick();
    expect(
      collectComponentRootElements(fixture.subTree()).map((element) =>
        element.getAttribute("data-testid"),
      ),
    ).toContain("resolved");
  });

  it("selects DOM roots from two real mounted Vue applications", async () => {
    const appA = mount(
      defineComponent({
        render: () => h("button", { "data-testid": "app-a" }, "A"),
      }),
      "app-a-container",
    );
    const appB = mount(
      defineComponent({
        render: () => h("button", { "data-testid": "app-b" }, "B"),
      }),
      "app-b-container",
    );
    await nextTick();
    const roots = new Map([
      ["app-a", appA],
      ["app-b", appB],
    ]);
    const source = runtimeSource({
      getComponentRoots: (appId) =>
        collectComponentRootElements(roots.get(appId)?.subTree()),
    });
    const api = createProbeAPI(source);

    await expect(
      api.getComponentDOM("root", { appId: "app-b" }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        appId: "app-b",
        roots: [{ selector: '[data-testid="app-b"]' }],
      },
    });
  });

  it("reads real option and setup Pinia stores through the public facade", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const useUsers = defineStore("users-runtime", {
      state: () => ({ users: [{ id: 1, name: "Ada" }] }),
      getters: { count: (state) => state.users.length },
    });
    const useSession = defineStore("session-runtime", () => {
      const token = ref("secret");
      const authenticated = computed(() => token.value.length > 0);
      return { token, authenticated };
    });
    let users!: ReturnType<typeof useUsers>;
    let session!: ReturnType<typeof useSession>;
    const container = document.createElement("div");
    container.id = "pinia-app";
    document.body.append(container);
    const app = createApp(
      defineComponent({
        setup() {
          users = useUsers();
          session = useSession();
          return () => h("div", `${users.count}:${session.authenticated}`);
        },
      }),
    );
    app.use(pinia);
    app.mount(container);
    mounted.push({
      app,
      container,
      subTree: () =>
        (app as unknown as { _instance?: { subTree?: unknown } })._instance
          ?.subTree,
    });
    await nextTick();

    const states = new Map<string, RawPiniaState>([
      [
        users.$id,
        {
          appId: "app-a",
          storeId: users.$id,
          state: users.$state as unknown as Record<string, unknown>,
          getters: { count: users.count },
        },
      ],
      [
        session.$id,
        {
          appId: "app-a",
          storeId: session.$id,
          state: session.$state as unknown as Record<string, unknown>,
          getters: { authenticated: session.authenticated },
        },
      ],
    ]);
    const source = runtimeSource({
      getPiniaStores: async (appId, _filter, includeKeys) =>
        [...states.values()].map((store) => ({
          appId,
          id: store.storeId,
          ...(includeKeys
            ? {
                stateKeys: Object.keys(store.state),
                getterKeys: Object.keys(store.getters ?? {}),
              }
            : {}),
        })),
      getPiniaState: async (_appId, storeId) => states.get(storeId)!,
    });
    const api = createProbeAPI(source);

    await expect(
      api.getPiniaStores({ appId: "app-a", includeKeys: true }),
    ).resolves.toMatchObject({
      ok: true,
      data: [
        { id: "users-runtime", stateKeys: ["users"], getterKeys: ["count"] },
        {
          id: "session-runtime",
          stateKeys: ["token"],
          getterKeys: ["authenticated"],
        },
      ],
    });
    const detail = await api.getDetailedState(
      { kind: "pinia", storeId: "users-runtime", appId: "app-a" },
      ["state", "users"],
      { limit: 1, maxEntries: 2 },
    );
    expect(detail).toMatchObject({
      ok: true,
      data: {
        target: {
          kind: "pinia",
          storeId: "users-runtime",
          appId: "app-a",
        },
        value: [{ id: 1, name: "Ada" }],
      },
    });
  });
});

function runtimeSource(
  overrides: Partial<ProbeDataSource> = {},
): ProbeDataSource {
  return {
    init() {},
    hasApp: (appId) => appId === "app-a" || appId === "app-b",
    hasPiniaInspector: async () => true,
    listApps: () => [
      { id: "app-a", name: "A", vueVersion: "3.5.22", active: true },
      { id: "app-b", name: "B", vueVersion: "3.5.22", active: false },
    ],
    getActiveAppId: () => "app-a",
    getRevision: () => 0,
    getComponentTree: async (appId) => ({
      appId,
      rootId: "root",
      nodes: [],
    }),
    getComponentState: async (appId, componentId) => ({
      appId,
      componentId,
      name: "RuntimeRoot",
      state: {},
    }),
    getPiniaStores: async () => [],
    getPiniaState: async (appId, storeId) => ({ appId, storeId, state: {} }),
    getComponentFromElement: () => ({
      componentId: "root",
      name: "RuntimeRoot",
    }),
    getComponentRoots: () => [],
    ...overrides,
  };
}
