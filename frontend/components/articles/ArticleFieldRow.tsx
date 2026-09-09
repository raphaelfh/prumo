/**
 * ArticleFieldRow: a Zotero-style label -> value row.
 *
 * Read state renders the label (fixed-width, right-aligned, muted) and the
 * committed value as plain text. Clicking the value (or focusing the row and
 * pressing Enter/Space) swaps the value area for the control named by
 * `control`, focused. Enter or blur commits the draft via `onCommit`; Escape
 * reverts. Committing is NOT saving — it only updates the parent's in-memory
 * form state, exactly like typing into an always-on input does today. Only
 * one row is ever in edit state at a time -- each instance owns its own
 * `editing` flag, but that alone would not stop two rows from both being
 * `true`. What actually enforces it: entering edit on a row focuses its
 * control, and focusing one element natively blurs whatever was focused
 * before, so the previous row's blur handler always commits or reverts it
 * before the new row's `editing` flips to true. `control='select'` adds one
 * more piece -- Radix's Select is modal while open (it sets
 * `pointer-events: none` on the rest of the page and traps focus in its
 * portal), so a second row cannot be reached at all until the popover closes
 * and its own blur/commit has run.
 *
 * For `control='multiline'`, plain Enter inserts a newline (it is a
 * paragraph field); Cmd/Ctrl+Enter is the explicit keyboard commit. Blur
 * still commits too.
 *
 * Focus management: entering edit state focuses the control and places the
 * caret at the END of its existing text, for text/multiline (never
 * select-all -- that would make the first keystroke replace the whole
 * value instead of appending to it) in an effect keyed on `editing` — never
 * during render, per the React Compiler's `panicThreshold: 'all_errors'`. Leaving
 * edit state (commit or revert) returns focus to the read-state button via
 * the same effect, so keyboard users are never stranded. The label and the
 * currently-rendered control always share one `id` (via `useId`), so the
 * accessible name survives the read/edit swap.
 *
 * `draft` contract: `draft` is seeded from `value` only when `enterEdit`
 * runs (the read -> edit transition); it is never resynced while
 * `editing === true`, even if `value` changes underneath. That is safe only
 * because the caller remounts this row (not merely re-renders it) whenever
 * the underlying record identity changes — `ArticleForm` does this by
 * keying its field rows on article identity. This component does not and
 * cannot enforce that convention itself; a caller that swaps `value` for a
 * different record's field while a row is mid-edit, without remounting,
 * will show a stale draft against the new record.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { t } from "@/lib/copy";

export interface ArticleFieldRowProps {
    label: string;
    /** Current committed value, rendered as text in read state. */
    value: string;
    /** Commit a new value to the parent's form state. Not a save. */
    onCommit: (next: string) => void;
    /** Which control edit state renders. Default 'text'. */
    control?: "text" | "multiline" | "select" | "switch";
    /** For control='select'. */
    options?: { value: string; label: string }[];
    /**
     * For control='switch': the read-state label for each state. Defaults to
     * shared copy keys ("On"/"Off"). The commit contract is unaffected --
     * `onCommit` always receives the literal string "true"/"false" regardless
     * of this wording.
     */
    switchLabels?: { on: string; off: string };
    placeholder?: string;
    /** Marks the row required and surfaces the error. */
    error?: string;
    disabled?: boolean;
    /**
     * Supplementary text rendered beneath the value, inside the same value
     * column -- already aligned with the control, so callers never need a
     * hardcoded offset to line it up under the label column.
     */
    hint?: ReactNode;
}

type EditableControlElement = HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement;

export function ArticleFieldRow({
    label,
    value,
    onCommit,
    control = "text",
    options,
    switchLabels,
    placeholder,
    error,
    disabled,
    hint,
}: ArticleFieldRowProps) {
    const fieldId = useId();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const rowRef = useRef<HTMLButtonElement>(null);
    const controlRef = useRef<EditableControlElement>(null);
    const wasEditingRef = useRef(false);
    /**
     * Set by commit()/revert() immediately before setEditing(false), and
     * consumed (and cleared) by the next handleBlur. In a real browser,
     * removing the still-focused control from the DOM -- which
     * setEditing(false) triggers -- synchronously fires a native
     * blur/focusout on the node being detached. That event reaches this
     * component's onBlur through React's delegation, i.e. handleBlur runs
     * AGAIN after Escape/Enter already handled the edit: Escape's revert()
     * would be followed by a blur-triggered commit(draft) of the value the
     * user just discarded, and Enter's commit() would be followed by a
     * second, duplicate commit(draft) call. This guard makes that second
     * call a no-op.
     *
     * jsdom does not implement synchronous blur-on-removal, so it can
     * never generate this ordering on its own -- a green Vitest run is NOT
     * evidence this guard is safe to delete. It was removed once already
     * on exactly that reasoning, and the deletion was a regression. See
     * the "guard blocks the removal-triggered blur" tests in
     * ArticleFieldRow.test.tsx, which reproduce the ordering by hand.
     */
    const suppressBlurRef = useRef(false);
    /**
     * Set by commit()/revert() immediately before setEditing(false), read
     * (and reset) by the editing-effect below. Only the explicit keyboard
     * exits (Enter, Cmd/Ctrl+Enter, Escape) set this to true -- blur is also
     * a valid way to leave edit state (Tab, clicking elsewhere), and
     * refocusing the row button on blur would yank focus right back and
     * swallow the Tab that just fired it.
     */
    const restoreFocusRef = useRef(false);
    /**
     * Tracks whether the `control='select'` popover is currently open, via
     * Radix's `onOpenChange`. Radix's Select renders its options in a
     * PORTAL, so opening it -- and choosing an option inside it -- both
     * blur the trigger. A blur-to-revert handler that does not know the
     * popover is open would revert the row (and unmount the Select) before
     * the option's `onValueChange` commit lands, which is exactly the bug
     * this ref fixes: the trigger's blur handler skips the revert while
     * this is true.
     */
    const selectOpenRef = useRef(false);

    useEffect(() => {
        if (editing) {
            const node = controlRef.current;
            node?.focus();
            if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
                // Place the caret at the end rather than selecting the whole
                // value: Zotero-style click-to-edit means the user edits the
                // existing value, not retypes it. `select()` would highlight
                // everything, so the first keystroke wipes it out.
                const end = node.value.length;
                node.setSelectionRange(end, end);
            }
        } else if (wasEditingRef.current && restoreFocusRef.current) {
            rowRef.current?.focus();
        }
        restoreFocusRef.current = false;
        wasEditingRef.current = editing;
    }, [editing]);

    const enterEdit = () => {
        if (disabled) return;
        setDraft(value);
        setEditing(true);
    };

    const commit = (next: string, options?: { refocus?: boolean }) => {
        suppressBlurRef.current = true;
        restoreFocusRef.current = options?.refocus ?? false;
        onCommit(next);
        setEditing(false);
    };

    const revert = (options?: { refocus?: boolean }) => {
        suppressBlurRef.current = true;
        restoreFocusRef.current = options?.refocus ?? false;
        setEditing(false);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === "Enter") {
            if (control === "multiline") {
                // Plain Enter must keep inserting a newline (this is a
                // paragraph field); Cmd/Ctrl+Enter is the explicit keyboard
                // commit, since blur-to-commit is the only other path here.
                if (!(event.metaKey || event.ctrlKey)) return;
                event.preventDefault();
                commit(draft, { refocus: true });
                return;
            }
            if (event.shiftKey) return;
            event.preventDefault();
            commit(draft, { refocus: true });
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            revert({ refocus: true });
        }
    };

    const handleBlur = () => {
        if (suppressBlurRef.current) {
            suppressBlurRef.current = false;
            return;
        }
        commit(draft);
    };

    /**
     * Blur handler for the `control='select'` trigger. Skips the revert
     * while the popover is open (see `selectOpenRef`) so that choosing an
     * option -- which blurs the trigger on its way to `onValueChange` --
     * does not revert the row out from under the commit.
     */
    const handleSelectBlur = () => {
        if (suppressBlurRef.current) {
            suppressBlurRef.current = false;
            return;
        }
        if (selectOpenRef.current) return;
        revert();
    };

    const resolvedSwitchLabels = switchLabels ?? {
        on: t("articles", "switchOn"),
        off: t("articles", "switchOff"),
    };
    const displayValue =
        control === "switch"
            ? value === "true"
                ? resolvedSwitchLabels.on
                : resolvedSwitchLabels.off
            : control === "select" && value.trim().length > 0
              ? ((options ?? []).find((option) => option.value === value)?.label ?? value)
              : value.trim().length > 0
                ? value
                : t("articles", "fieldRowEmptyPlaceholder");
    const isEmpty = control === "switch" ? false : value.trim().length === 0;

    return (
        <div className="flex items-baseline gap-2 py-1">
            <Label
                htmlFor={fieldId}
                className={cn("w-32 shrink-0 text-right text-muted-foreground", disabled && "opacity-50")}
            >
                {label}
            </Label>
            <div className="min-w-0 flex-1">
                {editing ? (
                    control === "multiline" ? (
                        <Textarea
                            id={fieldId}
                            ref={controlRef as React.RefObject<HTMLTextAreaElement>}
                            value={draft}
                            placeholder={placeholder}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={handleBlur}
                            className="text-[13px]"
                        />
                    ) : control === "switch" ? (
                        <Switch
                            id={fieldId}
                            ref={controlRef as React.RefObject<HTMLButtonElement>}
                            checked={draft === "true"}
                            onCheckedChange={(checked) => commit(checked ? "true" : "false")}
                            onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    revert({ refocus: true });
                                }
                            }}
                            onBlur={() => revert()}
                        />
                    ) : control === "select" ? (
                        <Select
                            value={draft}
                            onValueChange={(next) => commit(next)}
                            onOpenChange={(open) => {
                                selectOpenRef.current = open;
                            }}
                        >
                            <SelectTrigger
                                id={fieldId}
                                ref={controlRef as React.RefObject<HTMLButtonElement>}
                                onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                        event.preventDefault();
                                        revert({ refocus: true });
                                    }
                                }}
                                onBlur={handleSelectBlur}
                            >
                                <SelectValue placeholder={placeholder} />
                            </SelectTrigger>
                            <SelectContent>
                                {(options ?? []).map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <Input
                            id={fieldId}
                            ref={controlRef as React.RefObject<HTMLInputElement>}
                            value={draft}
                            placeholder={placeholder}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={handleBlur}
                            className="h-8 text-[13px]"
                            aria-invalid={error ? true : undefined}
                        />
                    )
                ) : (
                    <button
                        ref={rowRef}
                        id={fieldId}
                        type="button"
                        disabled={disabled}
                        onClick={enterEdit}
                        className={cn(
                            "block w-full rounded-sm px-1 py-0.5 text-left text-[13px] hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            control === "multiline"
                                ? "line-clamp-3 whitespace-pre-line"
                                : "truncate",
                            isEmpty && "text-muted-foreground",
                        )}
                    >
                        {displayValue}
                    </button>
                )}
                {error && <p className="mt-0.5 text-xs text-destructive">{error}</p>}
                {hint && <p className="mt-0.5 text-[12px] text-muted-foreground/70">{hint}</p>}
            </div>
        </div>
    );
}
