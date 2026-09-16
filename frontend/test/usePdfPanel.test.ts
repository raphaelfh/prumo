import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePdfPanel } from "@/hooks/usePdfPanel";

describe("usePdfPanel", () => {
  it("defaults to closed when no opts", () => {
    const { result } = renderHook(() => usePdfPanel());
    expect(result.current.isOpen).toBe(false);
  });

  it("defaults to closed when initialOpen=false explicit", () => {
    const { result } = renderHook(() => usePdfPanel({ initialOpen: false }));
    expect(result.current.isOpen).toBe(false);
  });

  it("opens when initialOpen=true", () => {
    const { result } = renderHook(() => usePdfPanel({ initialOpen: true }));
    expect(result.current.isOpen).toBe(true);
  });

  it("toggle flips state", () => {
    const { result } = renderHook(() => usePdfPanel());
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  it("open is idempotent", () => {
    const { result } = renderHook(() => usePdfPanel());
    act(() => result.current.open());
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
  });

  it("close is idempotent", () => {
    const { result } = renderHook(() => usePdfPanel({ initialOpen: true }));
    act(() => result.current.close());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });

  describe("expanded (PDF maximized over the form pane)", () => {
    it("starts collapsed", () => {
      const { result } = renderHook(() => usePdfPanel({ initialOpen: true }));
      expect(result.current.isExpanded).toBe(false);
    });

    it("toggleExpanded flips state", () => {
      const { result } = renderHook(() => usePdfPanel({ initialOpen: true }));
      act(() => result.current.toggleExpanded());
      expect(result.current.isExpanded).toBe(true);
      act(() => result.current.toggleExpanded());
      expect(result.current.isExpanded).toBe(false);
    });

    /** Expanding is also a way to open: maximizing a hidden panel must show it. */
    it("expanding a closed panel opens it", () => {
      const { result } = renderHook(() => usePdfPanel({ initialOpen: false }));
      act(() => result.current.toggleExpanded());
      expect(result.current.isExpanded).toBe(true);
      expect(result.current.isOpen).toBe(true);
    });

    /** Otherwise ⌘⇧B would hide a maximized pane and leave `expanded` stranded. */
    it("closing the panel also collapses it", () => {
      const { result } = renderHook(() => usePdfPanel({ initialOpen: true }));
      act(() => result.current.toggleExpanded());
      act(() => result.current.close());
      expect(result.current.isOpen).toBe(false);
      expect(result.current.isExpanded).toBe(false);
    });

    it("toggling the panel shut while expanded collapses it too", () => {
      const { result } = renderHook(() => usePdfPanel({ initialOpen: true }));
      act(() => result.current.toggleExpanded());
      act(() => result.current.toggle());
      expect(result.current.isOpen).toBe(false);
      expect(result.current.isExpanded).toBe(false);
    });

    it("collapse is idempotent and leaves the panel open", () => {
      const { result } = renderHook(() => usePdfPanel({ initialOpen: true }));
      act(() => result.current.toggleExpanded());
      act(() => result.current.collapse());
      act(() => result.current.collapse());
      expect(result.current.isExpanded).toBe(false);
      expect(result.current.isOpen).toBe(true);
    });
  });
});
