/** Leave the single-page app for a URL outside it (a full browser navigation). */
export function leaveApp(url: string): void {
  window.location.assign(url);
}
