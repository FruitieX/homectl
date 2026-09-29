/** Automatic navigation can drop DOM fullscreen, which normally requires a new
 * gesture to restore. Live data continues updating without document reloads. */
export function displayModeEnabled(): boolean {
  try {
    return localStorage.getItem('fullscreen') === 'true';
  } catch {
    return false;
  }
}
export function mayAutomaticallyReload(hasDraft: boolean): boolean {
  return !hasDraft && !displayModeEnabled() && !document.fullscreenElement;
}
export function nextDailyRefresh(now: Date): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}
