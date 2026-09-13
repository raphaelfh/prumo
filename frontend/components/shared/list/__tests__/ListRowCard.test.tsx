import {describe, expect, it, vi} from "vitest";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ListRowCard} from "../ListRowCard";

function renderCard(onClick = vi.fn(), onAction = vi.fn(), onToggle = vi.fn()) {
    render(
        <ListRowCard
            title="First article"
            leading={<input type="checkbox" aria-label="Select" onChange={onToggle}/>}
            primaryAction={<button type="button" onClick={onAction}>Act</button>}
            onClick={onClick}
        />,
    );
    return {onClick, onAction, onToggle};
}

describe("ListRowCard", () => {
    it("opens the row from the keyboard through a button named by its title", async () => {
        const user = userEvent.setup();
        const {onClick} = renderCard();

        const row = screen.getByRole("button", {name: "First article"});
        // The stretched control never wraps the row's other controls.
        expect(row.children).toHaveLength(0);

        row.focus();
        await user.keyboard("{Enter}");
        await user.keyboard(" ");
        expect(onClick).toHaveBeenCalledTimes(2);
    });

    it("keeps the leading control and actions from opening the row", async () => {
        const user = userEvent.setup();
        const {onClick, onAction, onToggle} = renderCard();

        await user.click(screen.getByRole("checkbox", {name: "Select"}));
        await user.click(screen.getByRole("button", {name: "Act"}));

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onAction).toHaveBeenCalledTimes(1);
        expect(onClick).not.toHaveBeenCalled();
    });

    it("renders no row control when the row is not clickable", () => {
        render(<ListRowCard title="Static" primaryAction={null}/>);
        expect(screen.queryByRole("button")).toBeNull();
    });
});
