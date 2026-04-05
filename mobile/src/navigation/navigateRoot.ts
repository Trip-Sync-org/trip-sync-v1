/**
 * Navigate to a screen registered on the root stack (e.g. Payout, TripDetail) from inside tab screens.
 * Walking up fixes cases where a single `getParent()` does not reach the stack navigator.
 */
export function navigateToRootStack(
  navigation: {
    getState?: () => { routeNames?: string[] } | undefined;
    getParent?: () => unknown;
    navigate: (name: string, params?: object) => void;
  },
  name: string,
  params?: Record<string, unknown>,
): void {
  let nav: unknown = navigation;
  for (let i = 0; i < 10; i++) {
    const n = nav as {
      getState?: () => { routeNames?: string[] } | undefined;
      getParent?: () => unknown;
      navigate?: (routeName: string, p?: object) => void;
    };
    const state = n.getState?.();
    const routeNames = state?.routeNames;
    if (routeNames?.includes(name)) {
      n.navigate?.(name, params);
      return;
    }
    const next = n.getParent?.();
    if (next == null) break;
    nav = next;
  }
  navigation.navigate(name, params);
}
