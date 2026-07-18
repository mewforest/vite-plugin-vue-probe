import type {
  ProbeErrorCode,
  ProbeResult,
  ResponseMeta,
} from "../public-types.js";
import type { QueryPlan } from "./plan.js";

const LOCAL_META: ResponseMeta = Object.freeze({
  requestId: "probe-query-0",
  revision: 0,
  observedAt: "1970-01-01T00:00:00.000Z",
});

export class ProbeQueryError extends Error {
  override readonly name = "ProbeQueryError";

  constructor(
    message: string,
    readonly code: ProbeErrorCode,
    readonly meta: ResponseMeta,
    readonly step: string,
    readonly query: string,
  ) {
    super(message);
  }
}

export function describeQueryPlan(plan: QueryPlan): string {
  switch (plan.kind) {
    case "apps":
      return "apps";
    case "app":
      return plan.selector.kind === "default"
        ? "app(default)"
        : plan.selector.kind === "id"
          ? `app(id:${plan.selector.id})`
          : `app(name:${plan.selector.name})`;
    case "tree":
      return `${describeQueryPlan(plan.app)}.tree`;
    case "component":
      return `${describeQueryPlan(plan.app)}.component(${plan.name}).nth(${plan.index})`;
    case "components":
      return `${describeQueryPlan(plan.app)}.components(${plan.name ?? "*"})`;
    case "component-state":
      return `${describeQueryPlan(plan.component)}.get`;
    case "detailed-state":
      return `${describeQueryPlan(plan.target)}.get(${plan.path.join(".")})`;
    case "pinia-stores":
      return `${describeQueryPlan(plan.app)}.pinia`;
    case "pinia-store":
      return `${describeQueryPlan(plan.app)}.pinia(${plan.storeId})`;
    case "pinia-state":
      return `${describeQueryPlan(plan.store)}.get`;
    case "component-dom":
      return `${describeQueryPlan(plan.component)}.dom`;
    case "component-from-dom":
      return `${describeQueryPlan(plan.app)}.fromDOM(${typeof plan.target === "string" ? plan.target : "[Element]"})`;
  }
}

export function queryError(
  plan: QueryPlan,
  code: ProbeErrorCode,
  message: string,
  step: string,
): ProbeQueryError {
  return new ProbeQueryError(
    message,
    code,
    LOCAL_META,
    step,
    describeQueryPlan(plan),
  );
}

export function unwrapProbeResult<T>(
  result: ProbeResult<T>,
  step: string,
  plan: QueryPlan,
): { data: T; meta: ResponseMeta } {
  if (!result.ok) {
    throw new ProbeQueryError(
      result.error.message,
      result.error.code,
      result.meta,
      step,
      describeQueryPlan(plan),
    );
  }
  return { data: result.data, meta: result.meta };
}
