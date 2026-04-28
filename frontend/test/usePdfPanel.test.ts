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
});
