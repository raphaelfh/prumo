/**
 * List + detail split: a list on the left (on top below lg), a docked panel
 * on the right (underneath below lg). Articles and Screening sit on it.
 *
 * The shell owns the layout, the Topbar panel toggle, the shortcuts (⌘⇧B,
 * opt-in ⇧⌘\ maximize, opt-in Escape chain) and, unless the caller passes
 * `maximized`, the maximized flag. The caller owns whether the panel is open,
 * the selection, the panel content and any guard on closing (Articles asks
 * before discarding edits).
 *
 * Deliberately NOT RunSplitShell: its `assessment-shell*` panel ids are the
 * DOM test contract for the run screens' specs, and it carries an in-shell
 * PDF toggle that is wrong for a list + detail screen. Both are built on the
 * same ResizablePanelGroup primitives.
 */
import {type ReactNode, useEffect, useLayoutEffect, useRef, useState} from 'react';

import {PanelToggleButton} from '@/components/layout/PanelToggleButton';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable';
import {useSetHeaderActions} from '@/contexts/HeaderActionsContext';
import {useIsBelowDesktop} from '@/hooks/use-mobile';
import {type Binding, isDialogOpen, isTypingTarget, useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';

export interface ListDetailSplitShellProps {
  list: ReactNode;
  panel: ReactNode;
  /** Controlled: the caller owns open state (Articles guards close behind a discard dialog). */
  panelOpen: boolean;
  /** Every open/close request: Topbar toggle, ⌘⇧B, Esc's panel step, ⇧⌘\ on a closed panel. */
  onPanelOpenChange: (open: boolean) => void;
  /** Panel ids `${idPrefix}-list` and `${idPrefix}-panel` (also their data-testid). */
  idPrefix: string;
  /** Accessible name + tooltip of the Topbar PanelToggleButton. */
  toggleLabel: string;
  /** ⇧⌘\ maximizes the panel (list stays mounted, hidden). Default false. */
  maximizable?: boolean;
  /** Controlled maximize. When `maximized` is passed the shell keeps no maximize state of its own and never resets it during render: the caller clears it (e.g. when it closes the panel). */
  maximized?: boolean;
  onMaximizedChange?: (maximized: boolean) => void;
  /** Escape undoes one step per press: maximize → panel → URL selection → checked rows. Default false. */
  escapeCloses?: boolean;
  /** Esc's selection step (the URL param); read only when escapeCloses. */
  hasSelection?: boolean;
  onClearSelection?: () => void;
  /** Esc's last step. A consumer passing these passes no `deselectAll` to useListKeyboardShortcuts. */
  checkedCount?: number;
  onClearChecked?: () => void;
}

export function ListDetailSplitShell({
  list,
  panel,
  panelOpen,
  onPanelOpenChange,
  idPrefix,
  toggleLabel,
  maximizable = false,
  maximized: controlledMaximized,
  onMaximizedChange,
  escapeCloses = false,
  hasSelection = false,
  onClearSelection,
  checkedCount,
  onClearChecked,
}: ListDetailSplitShellProps) {
  const belowDesktop = useIsBelowDesktop();
  const controlled = controlledMaximized !== undefined;
  const [localMaximized, setLocalMaximized] = useState(false);
  // Uncontrolled: a closed panel is never maximized, whichever path closed it
  // (including the caller's own discard confirm), so reopening docks it
  // again. Controlled: no reset here — a caller opening the panel maximized
  // sets both flags in one update, and it clears `maximized` itself.
  if (!controlled && !panelOpen && localMaximized) setLocalMaximized(false);
  const isMaximized = maximizable && panelOpen && (controlled ? controlledMaximized : localMaximized);
  const setMaximized = (next: boolean) => {
    if (controlled) onMaximizedChange?.(next);
    else setLocalMaximized(next);
  };

  const toggle = () => onPanelOpenChange(!panelOpen);

  // ⌘⇧B / Ctrl+Shift+B: ⌘B is the app sidebar, so this panel takes Shift.
  const bindings: Binding[] = [{type: 'chord', key: 'b', mod: true, shift: true, handler: toggle}];
  if (maximizable) {
    // ⇧⌘\ maximizes, matched on `code`: Shift+\ reports `e.key === '|'`.
    bindings.push({
      type: 'chord',
      key: '\\',
      code: 'Backslash',
      mod: true,
      shift: true,
      handler: () => {
        if (!panelOpen) {
          setMaximized(true);
          onPanelOpenChange(true);
        } else {
          setMaximized(!isMaximized);
        }
      },
    });
  }
  useKeyboardShortcuts({bindings, enabled: true});

  // Escape undoes one step per press, in this order: an open popover/menu/
  // dialog (Radix dismisses it; we yield) → maximize → panel → URL selection
  // → checked rows. CAPTURE phase, so it outranks every bubble-phase Escape
  // handler (useListKeyboardShortcuts included) and stopPropagation keeps a
  // second handler from undoing another step on the same press. It yields to
  // an open overlay and to a text field, where Escape belongs to the control.
  // It also yields to an open tooltip, which Radix dismisses on this press;
  // the tooltip is deliberately not an overlay for every other shortcut.
  useEffect(() => {
    if (!escapeCloses) return;
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented || isDialogOpen() || isTypingTarget(event)) return;
      if (document.querySelector('[role="tooltip"]')) return;
      if (isMaximized) setMaximized(false);
      else if (panelOpen) onPanelOpenChange(false);
      else if (hasSelection && onClearSelection) onClearSelection();
      else if ((checkedCount ?? 0) > 0 && onClearChecked) onClearChecked();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDownCapture, {capture: true});
    return () => window.removeEventListener('keydown', onKeyDownCapture, {capture: true});
  });

  // Maximizing hides the list: focus inside it would drop to <body>, so it
  // moves to the panel. A layout effect runs before the browser's focus
  // fixup. Focus elsewhere stays put; restoring moves nothing.
  const listEl = useRef<HTMLDivElement>(null);
  const panelElRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!isMaximized) return;
    if (listEl.current?.contains(document.activeElement)) panelElRef.current?.focus();
  }, [isMaximized]);

  useSetHeaderActions(
    <PanelToggleButton
      side={belowDesktop ? 'bottom' : 'right'}
      pressed={panelOpen}
      onToggle={toggle}
      ariaLabel={toggleLabel}
      shortcut={['mod', '⇧', 'B']}
    />,
  );

  // Maximized: nothing leaves the tree, so neither the list nor the panel body
  // remounts (list state survives). The list and handle are hidden with the
  // `hidden` attribute: Tailwind's preflight makes it `display: none
  // !important`, which beats the panel's inline `display: flex`.
  return (
    <ResizablePanelGroup orientation={belowDesktop ? 'vertical' : 'horizontal'} className="h-full">
      <ResizablePanel
        key="list"
        id={`${idPrefix}-list`}
        elementRef={listEl}
        defaultSize={panelOpen ? '55%' : '100%'}
        minSize={isMaximized ? '0%' : '35%'}
        hidden={isMaximized || undefined}
      >
        {/* The tab is full-bleed (no page gutter), so the list owns a minimal
            inset — without it the toolbar and the table card sat flush
            against the window edge and the split handle. */}
        <div className="flex h-full min-h-0 flex-col p-2">{list}</div>
      </ResizablePanel>
      {panelOpen ? <ResizableHandle key="handle" withHandle hidden={isMaximized || undefined}/> : null}
      {panelOpen ? (
        <ResizablePanel
          key="panel"
          id={`${idPrefix}-panel`}
          elementRef={panelElRef}
          tabIndex={-1}
          defaultSize="45%"
          minSize={isMaximized ? '100%' : '30%'}
          maxSize={isMaximized ? '100%' : '65%'}
          data-maximized={isMaximized || undefined}
        >
          {panel}
        </ResizablePanel>
      ) : null}
    </ResizablePanelGroup>
  );
}
