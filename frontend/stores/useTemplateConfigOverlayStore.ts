/**
 * Which full-screen overlay the Configuration tab is showing (B-9b2a).
 *
 * Exists for exactly one reason: the diff sheet's trigger lives in the
 * command bar (`TemplateConfigPublishControls`) while the inspector Sheet
 * lives in the grid (`TemplateConfigGridPanel`), and the two are siblings
 * under the editor. Two modal sheets must never stack, so the grid has to
 * see the diff sheet open — cross-component UI state, which is what a
 * store is for.
 *
 * @module stores/useTemplateConfigOverlayStore
 */
import {create} from 'zustand';

interface TemplateConfigOverlayState {
  /** True while the read-only diff sheet is open. */
  diffSheetOpen: boolean;
  setDiffSheetOpen: (open: boolean) => void;
}

export const useTemplateConfigOverlayStore = create<TemplateConfigOverlayState>(
  (set) => ({
    diffSheetOpen: false,
    setDiffSheetOpen: (open) => set({diffSheetOpen: open}),
  }),
);
