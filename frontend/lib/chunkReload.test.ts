import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { installChunkReload } from "./chunkReload";

function firePreloadError(): Event {
  const event = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("installChunkReload", () => {
  let reload: Mock<() => void>;
  let uninstall: () => void;

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    reload = vi.fn<() => void>();
    uninstall = installChunkReload(reload);
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  it("reloads once when a stale chunk fails to load after a deploy", () => {
    const event = firePreloadError();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not loop: a second failure right after the reload surfaces the error", () => {
    firePreloadError();
    const second = firePreloadError();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });

  it("reloads again once the guard window has passed", () => {
    firePreloadError();
    vi.advanceTimersByTime(60_000);
    firePreloadError();

    expect(reload).toHaveBeenCalledTimes(2);
  });
});
