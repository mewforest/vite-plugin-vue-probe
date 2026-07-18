import { createProbeQueryRoot } from "./builder.js";
import { createQueryExecutor } from "./executor.js";
import type { ProbeQueryOperations } from "./executor.js";
import type { QueryRuntime } from "./plan.js";
import { showQueryResult } from "./renderer.js";
import type { ProbeQueryRoot } from "./types.js";

export function createProbeQueryAPI(
  operations: ProbeQueryOperations,
): ProbeQueryRoot {
  const executor = createQueryExecutor(operations);
  const runtime: QueryRuntime = {
    run: (plan) => executor.execute(plan),
    show: async (plan, format) =>
      showQueryResult(
        plan,
        await executor.execute(plan),
        format,
        operations.formatters,
      ),
  };
  return createProbeQueryRoot(runtime);
}
