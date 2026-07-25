/**
 * The regression this hook exists to prevent: the QA overall-judgment banner
 * is computed SERVER-side, but autosave deliberately bypasses TanStack (it
 * would otherwise refetch the whole run view on every debounce tick). Without
 * a refresh, the banner contradicted the domain judgments visible on the same
 * screen for an entire editing session — a reviewer could fill all 16 domain
 * judgments and still read four em dashes.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRefetchOnSave } from "@/hooks/runs/useRefetchOnSave";

describe("useRefetchOnSave", () => {
  it("does not refetch before anything has been saved", () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnSave({ enabled: true, lastSavedAt: null, refetch }));
    expect(refetch).not.toHaveBeenCalled();
  });

  it("refetches once when a save lands", () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(
      ({ lastSavedAt }) => useRefetchOnSave({ enabled: true, lastSavedAt, refetch }),
      { initialProps: { lastSavedAt: null as Date | null } },
    );
    expect(refetch).not.toHaveBeenCalled();

    rerender({ lastSavedAt: new Date(1_000) });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("does not refetch again for the same save (no loop)", () => {
    const refetch = vi.fn();
    const saved = new Date(1_000);
    const { rerender } = renderHook(
      ({ lastSavedAt }) => useRefetchOnSave({ enabled: true, lastSavedAt, refetch }),
      { initialProps: { lastSavedAt: saved as Date | null } },
    );
    expect(refetch).toHaveBeenCalledTimes(1);

    // A re-render caused by the refetch itself must not re-trigger.
    rerender({ lastSavedAt: saved });
    rerender({ lastSavedAt: new Date(1_000) }); // equal timestamp, new object
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("refetches again on each subsequent save", () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(
      ({ lastSavedAt }) => useRefetchOnSave({ enabled: true, lastSavedAt, refetch }),
      { initialProps: { lastSavedAt: new Date(1_000) as Date | null } },
    );
    rerender({ lastSavedAt: new Date(2_000) });
    rerender({ lastSavedAt: new Date(3_000) });
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("stays inert when disabled, and does not replay past saves on enable", () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(
      ({ enabled, lastSavedAt }) => useRefetchOnSave({ enabled, lastSavedAt, refetch }),
      { initialProps: { enabled: false, lastSavedAt: null as Date | null } },
    );

    // Templates without computed overalls must never pay a run-view round-trip.
    rerender({ enabled: false, lastSavedAt: new Date(1_000) });
    rerender({ enabled: false, lastSavedAt: new Date(2_000) });
    expect(refetch).not.toHaveBeenCalled();

    // Enabling later syncs once against the newest save, not once per missed save.
    rerender({ enabled: true, lastSavedAt: new Date(2_000) });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
