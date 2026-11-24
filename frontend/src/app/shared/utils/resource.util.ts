/**
 * Reading `resource.value()` THROWS while the resource is in the `error` state (Angular 22),
 * which breaks change detection. Always read through this helper: it yields `undefined` instead,
 * so views can fall back to their error / skeleton states (and `keep()` retains the last good value).
 */
export function valueOrUndefined<T>(r: { hasValue(): boolean; value(): T }): T | undefined {
  return r.hasValue() ? r.value() : undefined;
}
