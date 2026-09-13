/**
 * A Zotero collection row used to be a <button> wrapping a Radix <Checkbox>
 * (itself a <button role="checkbox">): invalid nested interactive content,
 * two tab stops per row and a React DOM-nesting warning. The row is now one
 * control whose selected state is exposed through aria-pressed.
 */

import {describe, expect, it, vi} from "vitest";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ZoteroImportDialog} from "@/components/articles/ZoteroImportDialog";
import type {ZoteroCollection} from "@/types/zotero";

const collections = [
    {key: "c1", data: {name: "Trials"}, meta: {numItems: 3}},
    {key: "c2", data: {name: "Reviews"}, meta: {numItems: 1}},
] as unknown as ZoteroCollection[];

// Stable references: the dialog lists collections in an effect keyed on them.
const hookValue = {
    collections,
    loadingCollections: false,
    importing: false,
    progress: null,
    currentJobId: null,
    listCollections: vi.fn(),
    startImport: vi.fn(),
    cancelImport: vi.fn(),
    resetProgress: vi.fn(),
};

vi.mock("@/hooks/useZoteroImport", () => ({useZoteroImport: () => hookValue}));
vi.mock("@/stores/useBackgroundJobs", () => ({
    useBackgroundJobs: () => ({addJob: vi.fn(), updateJob: vi.fn()}),
}));
vi.mock("@/contexts/ProjectContext", () => ({useProject: () => ({project: null})}));

function rowFor(name: string): HTMLElement {
    return screen.getByText(name).closest("button") as HTMLElement;
}

describe("ZoteroImportDialog collection rows", () => {
    it("renders each row as exactly one interactive control", () => {
        render(<ZoteroImportDialog open onOpenChange={vi.fn()} projectId="p1"/>);

        const row = rowFor("Trials");
        expect(row).not.toBeNull();
        expect(row.querySelector("button, [role='checkbox'], input")).toBeNull();
        expect(document.querySelector("button button")).toBeNull();
    });

    it("clicking a row selects it and moves the selection off the previous row", async () => {
        const user = userEvent.setup();
        render(<ZoteroImportDialog open onOpenChange={vi.fn()} projectId="p1"/>);

        expect(rowFor("Trials")).toHaveAttribute("aria-pressed", "false");

        await user.click(rowFor("Trials"));
        expect(rowFor("Trials")).toHaveAttribute("aria-pressed", "true");
        expect(rowFor("Reviews")).toHaveAttribute("aria-pressed", "false");

        await user.click(rowFor("Reviews"));
        expect(rowFor("Trials")).toHaveAttribute("aria-pressed", "false");
        expect(rowFor("Reviews")).toHaveAttribute("aria-pressed", "true");
    });
});
