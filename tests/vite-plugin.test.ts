import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import vueProbe, {
  RESOLVED_VIRTUAL_CLIENT_ID,
  VIRTUAL_CLIENT_ID,
} from "../src/index";

describe("vite-plugin-vue-probe", () => {
  it("is an early serve-only plugin", () => {
    const plugin = vueProbe();
    expect(plugin).toMatchObject({
      name: "vite-plugin-vue-probe",
      apply: "serve",
      enforce: "pre",
    });
  });

  it("resolves and loads the virtual development client", () => {
    const plugin = vueProbe();
    const resolveId = plugin.resolveId as (id: string) => unknown;
    const load = plugin.load as (id: string) => unknown;
    expect(resolveId(VIRTUAL_CLIENT_ID)).toBe(RESOLVED_VIRTUAL_CLIENT_ID);
    expect(load(RESOLVED_VIRTUAL_CLIENT_ID)).toContain("installProbeAPI();");
    expect(resolveId("unrelated")).toBeUndefined();
  });

  it("prepends an inline module import and can be disabled", () => {
    const transform = vueProbe().transformIndexHtml as { handler(): unknown[] };
    expect(transform.handler()).toEqual([
      {
        tag: "script",
        attrs: { type: "module" },
        children: `import '${VIRTUAL_CLIENT_ID}';`,
        injectTo: "head-prepend",
      },
    ]);
    const disabled = vueProbe({ enabled: false });
    const disabledTransform = disabled.transformIndexHtml as {
      handler(): unknown[];
    };
    expect(disabledTransform.handler()).toEqual([]);
  });

  it("does not inject VUE_PROBE into a production application bundle", async () => {
    const work = join(process.cwd(), "work");
    await mkdir(work, { recursive: true });
    const root = await mkdtemp(join(work, "vue-probe-production-"));
    try {
      await writeFile(
        join(root, "index.html"),
        '<main id="app"></main><script type="module" src="/main.js"></script>',
      );
      await writeFile(
        join(root, "main.js"),
        'document.querySelector("#app").textContent = "production"',
      );
      await build({ root, logLevel: "silent", plugins: [vueProbe()] });
      const assets = await readdir(join(root, "dist", "assets"));
      const javascript = await Promise.all(
        assets
          .filter((file) => file.endsWith(".js"))
          .map((file) => readFile(join(root, "dist", "assets", file), "utf8")),
      );
      expect(javascript.join("\n")).not.toContain("VUE_PROBE");
      expect(
        await readFile(join(root, "dist", "index.html"), "utf8"),
      ).not.toContain(VIRTUAL_CLIENT_ID);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
