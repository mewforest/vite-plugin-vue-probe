# Component from DOM Design

## Goal

Add a read-only public API that resolves a DOM element to the Vue component that owns it. The result stays JSON-safe and can be passed directly to the existing component state and DOM methods.

## Public API

```ts
interface ComponentFromDOMOptions {
  appId?: string;
  expectedRevision?: number;
}

interface ComponentFromDOMResult {
  appId: string;
  componentId: string;
  name: string;
}

interface ProbeAPI {
  getComponentFromDOM(
    target: string | Element,
    options?: ComponentFromDOMOptions,
  ): Promise<ProbeResult<ComponentFromDOMResult>>;
}
```

The method accepts either a CSS selector or an `Element`. A selector is resolved with `document.querySelector`, so the first matching element is used. Both inputs then follow the same lookup path.

The API version is bumped from `0.3.0` to `0.4.0`. The package version remains controlled independently by the package release workflow.

## Lookup Semantics

The DevTools data-source bridge reads Vue's `__vueParentComponent` reference from the target element. This returns the nearest Vue component that owns the DOM node, matching the mechanism used by Vue DevTools' page component picker.

The bridge must not trust the runtime reference by itself. It verifies that the instance occurs in the selected application's `instanceMap` and returns the map's component id. This prevents an explicit `appId` from resolving a component belonging to another Vue application on the same page.

The raw Vue component instance never crosses the data-source boundary. The bridge returns only `componentId` and `name`; the facade adds the resolved `appId` and the standard response metadata.

## Architecture

The change follows the existing component-to-DOM layering:

1. Validation resolves and checks `target` and validates `appId` and `expectedRevision`.
2. The facade runs the operation through `runSnapshotForApp` for consistent app selection and revision checks.
3. `ProbeDataSource.getComponentFromElement(appId, element)` provides the internal lookup boundary.
4. `DevtoolsDataSource` delegates to its bridge, verifies the result, and maps lookup failures to public errors.
5. The facade returns `{ appId, componentId, name }` in the normal `ProbeResult` envelope.

The capability payload gains `componentFromDOM: true`.

## Validation and Errors

- An empty selector, malformed selector, non-string/non-Element target, unknown option, or invalid option value returns `INVALID_ARGUMENT`.
- If `document` is unavailable while resolving a selector, the call returns `NOT_READY`.
- If the selector matches no element, the element has no Vue owner, or its owner does not belong to the selected app, the call returns `COMPONENT_NOT_FOUND`.
- An unknown explicit `appId` keeps the existing `APP_NOT_FOUND` behavior.
- A mismatched or changing revision keeps the existing `STALE_REVISION` behavior.
- Property access and name resolution are guarded so unusual DOM objects cannot escape the public error envelope.

## Testing

Tests are added before production code and cover:

- facade success for both a selector and an `Element`;
- validation of targets and options;
- selector-not-found and malformed-selector errors;
- nearest component resolution through `__vueParentComponent`;
- rejection when the component belongs to a different app;
- anonymous component name fallback;
- revision checks and capability exposure;
- the complete public API key set and distributed type declarations.

After focused tests pass, run the full unit suite, typecheck, build, distribution smoke test, and distribution type test.

## Documentation

README and README_ru gain a DOM-to-component example showing both accepted target forms and chaining the returned `componentId` into `getComponentState`.

## Non-goals

- Returning `ComponentInternalInstance` or any other non-serializable Vue runtime object.
- Starting the interactive crosshair/highlighter UI.
- Searching across all Vue applications when an explicit `appId` is supplied.
- Supporting XPath or lists of selector matches.
