/**
 * ArticleFieldRow: a Zotero-style label -> value row.
 *
 * Read state renders the label (fixed-width, right-aligned, muted) and the
 * committed value as plain text. Clicking the value (or focusing the row and
 * pressing Enter/Space) swaps the value area for the control named by
 * `control`, focused. Enter or blur commits the draft via `onCommit`; Escape
 * reverts. Committing is NOT saving — it only updates the parent's in-memory
 * form state, exactly like typing into an always-on input does today. Only
 * one row is ever in edit state at a time because each instance owns its own
 * `editing` flag.
 *
 * Focus management: entering edit state focuses the control (and selects its
 * text, for text/multiline) in an effect keyed on `editing` — never during
 * render, per the React Compiler's `panicThreshold: 'all_errors'`. Leaving
 * edit state (commit or revert) returns focus to the read-state button via
 * the same effect, so keyboard users are never stranded. The label and the
 * currently-rendered control always share one `id` (via `useId`), so the
 * accessible name survives the read/edit swap.
 */
import { useEffect, useId, useRef, useState } from "react";

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
    placeholder?: string;
    /** Marks the row required and surfaces the error. */
    error?: string;
    disabled?: boolean;
}

type EditableControlElement = HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement;

export function ArticleFieldRow({
    label,
    value,
    onCommit,
    control = "text",
    options,
    placeholder,
    error,
    disabled,
}: ArticleFieldRowProps) {
    const fieldId = useId();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    // Echoes `value`, plus an optimistic update on commit. A real parent
    // applies the commit to its own state and hands back an updated `value`
    // prop next render — this local echo just means the row does not have to
    // wait a tick for that round trip to show what was just typed.
    const [committedValue, setCommittedValue] = useState(value);
    const lastPropValueRef = useRef(value);
    const rowRef = useRef<HTMLButtonElement>(null);
    const controlRef = useRef<EditableControlElement>(null);
    const wasEditingRef = useRef(false);
    const suppressBlurRef = useRef(false);

    useEffect(() => {
        if (value !== lastPropValueRef.current) {
            lastPropValueRef.current = value;
            setCommittedValue(value);
        }
    }, [value]);

    useEffect(() => {
        if (editing) {
            const node = controlRef.current;
            node?.focus();
            if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
                node.select();
            }
        } else if (wasEditingRef.current) {
            rowRef.current?.focus();
        }
        wasEditingRef.current = editing;
    }, [editing]);

    const enterEdit = () => {
        if (disabled) return;
        setDraft(committedValue);
        setEditing(true);
    };

    const commit = (next: string) => {
        onCommit(next);
        lastPropValueRef.current = next;
        setCommittedValue(next);
        setEditing(false);
    };

    const revert = () => {
        setEditing(false);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            suppressBlurRef.current = true;
            commit(draft);
        } else if (event.key === "Escape") {
            event.preventDefault();
            suppressBlurRef.current = true;
            revert();
        }
    };

    const handleBlur = () => {
        if (suppressBlurRef.current) {
            suppressBlurRef.current = false;
            return;
        }
        commit(draft);
    };

    const displayValue =
        committedValue.trim().length > 0 ? committedValue : t("articles", "fieldRowEmptyPlaceholder");
    const isEmpty = committedValue.trim().length === 0;

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
                                    revert();
                                }
                            }}
                        />
                    ) : control === "select" ? (
                        <Select value={draft} onValueChange={(next) => commit(next)}>
                            <SelectTrigger id={fieldId} ref={controlRef as React.RefObject<HTMLButtonElement>}>
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
                            "block w-full truncate rounded-sm px-1 py-0.5 text-left text-[13px] hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            isEmpty && "text-muted-foreground",
                        )}
                    >
                        {displayValue}
                    </button>
                )}
                {error && <p className="mt-0.5 text-xs text-destructive">{error}</p>}
            </div>
        </div>
    );
}
