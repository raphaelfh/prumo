/**
 * ArticleFieldRow: the Zotero-style label -> value row primitive.
 * Read state is plain text; clicking (or Enter/Space while focused) swaps
 * the value area for the appropriate control, focused. Enter/blur commit,
 * Escape reverts. See task-2-brief.md for the full contract.
 */
import { useState } from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ArticleFieldRow, type ArticleFieldRowProps } from "@/components/articles/ArticleFieldRow";

// A minimal stand-in for a real parent: holds `value` in state and passes
// `onCommit` straight to `setValue`, exercising the real controlled-component
// contract (commit -> parent setState -> new `value` prop) rather than a
// bare `vi.fn()` that never feeds anything back.
function ControlledHarness({
    initialValue,
    onCommit,
    ...rest
}: Omit<ArticleFieldRowProps, "value" | "onCommit"> & {
    initialValue: string;
    onCommit: (next: string) => void;
}) {
    const [value, setValue] = useState(initialValue);
    return (
        <ArticleFieldRow
            {...rest}
            value={value}
            onCommit={(next) => {
                onCommit(next);
                setValue(next);
            }}
        />
    );
}

describe("ArticleFieldRow", () => {
  it("shows the value as read-only text, not an input", () => {
    render(<ArticleFieldRow label="Title" value="Some title" onCommit={vi.fn()} />);

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Some title")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("click enters edit state with the current value in the input", async () => {
    const user = userEvent.setup();
    render(<ArticleFieldRow label="Title" value="Some title" onCommit={vi.fn()} />);

    await user.click(screen.getByText("Some title"));

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("Some title");
    expect(input).toHaveFocus();
  });

  it("Enter commits the typed value and returns to read state showing it", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ControlledHarness label="Title" initialValue="Some title" onCommit={onCommit} />);

    await user.click(screen.getByText("Some title"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New title{Enter}");

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("New title");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("New title")).toBeInTheDocument();
  });

  it("Esc reverts without committing, restoring the original value", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ArticleFieldRow label="Title" value="Some title" onCommit={onCommit} />);

    await user.click(screen.getByText("Some title"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Discarded edit");
    // Precondition: the input really held the edited text before Esc.
    expect(input).toHaveValue("Discarded edit");

    await user.keyboard("{Escape}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Some title")).toBeInTheDocument();
  });

  it("blur commits the current draft", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <>
        <ControlledHarness label="Title" initialValue="Some title" onCommit={onCommit} />
        <button type="button">elsewhere</button>
      </>,
    );

    await user.click(screen.getByText("Some title"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Blurred edit");
    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Blurred edit");
    expect(screen.getByText("Blurred edit")).toBeInTheDocument();
  });

  it("is keyboard reachable: Enter on the focused read state enters edit state", async () => {
    const user = userEvent.setup();
    render(<ArticleFieldRow label="Title" value="Some title" onCommit={vi.fn()} />);

    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();

    await user.keyboard("{Enter}");

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("Some title");
    expect(input).toHaveFocus();
  });

  it("an empty value still renders a clickable placeholder that can be entered", async () => {
    const user = userEvent.setup();
    render(<ArticleFieldRow label="Title" value="" onCommit={vi.fn()} />);

    const readButton = screen.getByRole("button");
    expect(readButton).toHaveTextContent(/.+/);

    await user.click(readButton);

    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("the label stays associated with the control across the swap", async () => {
    const user = userEvent.setup();
    render(<ArticleFieldRow label="Title" value="Some title" onCommit={vi.fn()} />);

    await user.click(screen.getByText("Some title"));

    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
  });

  // Real browsers fire a synchronous native blur/focusout on a focused
  // node the instant React removes it from the DOM. jsdom does NOT
  // implement that step, so it can never generate this ordering on its
  // own — a prior version of this test called `input.blur()` on an
  // already-detached, already-unfocused node, which is a no-op regardless
  // of the guard's presence and proved nothing. To exercise the guard for
  // real, dispatch Escape/blur on the SAME still-mounted node inside one
  // shared `act()` block: nested `act()` calls only flush once the
  // outermost one returns, so both events are processed against the
  // pre-flush render — the input is still attached and still focused when
  // the blur reaches it, exactly the window a real browser produces.
  it("Escape's guard blocks the removal-triggered blur from committing the discarded draft", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ArticleFieldRow label="Title" value="Some title" onCommit={onCommit} />);

    await user.click(screen.getByText("Some title"));
    const input = screen.getByRole("textbox");
    await user.type(input, " more");

    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input);
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Some title")).toBeInTheDocument();
  });

  // Same ordering, Enter side: without the guard, commit() fires once from
  // handleKeyDown and a SECOND time from the removal-triggered blur.
  it("Enter's guard blocks the removal-triggered blur from double-committing", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ArticleFieldRow label="Title" value="Some title" onCommit={onCommit} />);

    await user.click(screen.getByText("Some title"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New title");

    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input);
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("New title");
  });

  it("control='multiline' renders a textarea in edit state", async () => {
    const user = userEvent.setup();
    render(
      <ArticleFieldRow label="Abstract" value="Long text" onCommit={vi.fn()} control="multiline" />,
    );

    await user.click(screen.getByText("Long text"));

    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });

  it("control='switch' commits on toggle", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ArticleFieldRow label="Open access" value="false" onCommit={onCommit} control="switch" />);

    await user.click(screen.getByRole("button"));
    const toggle = screen.getByRole("switch");
    await user.click(toggle);

    expect(onCommit).toHaveBeenCalledWith("true");
  });

  it("control='switch' renders a human label in read state, never the raw \"true\"/\"false\" string", () => {
    render(<ArticleFieldRow label="Open access" value="true" onCommit={vi.fn()} control="switch" />);

    expect(screen.queryByText("true")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).not.toHaveTextContent(/^(true|false)$/);
  });

  it("control='switch' with custom switchLabels renders the caller's wording and still commits \"true\"/\"false\"", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <ArticleFieldRow
        label="Open access"
        value="true"
        onCommit={onCommit}
        control="switch"
        switchLabels={{ on: "Yes, open access", off: "Not open access" }}
      />,
    );

    expect(screen.getByRole("button")).toHaveTextContent("Yes, open access");

    await user.click(screen.getByRole("button"));
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(onCommit).toHaveBeenCalledWith("false");
  });

  it("control='select' commits on choosing an option", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <ArticleFieldRow
        label="Item type"
        value="article"
        onCommit={onCommit}
        control="select"
        options={[
          { value: "article", label: "Article" },
          { value: "review", label: "Review" },
        ]}
      />,
    );

    await user.click(screen.getByText("article"));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Review" }));

    expect(onCommit).toHaveBeenCalledWith("review");
  });

  it("control='select': Escape reverts to read state without committing", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <ArticleFieldRow
        label="Item type"
        value="article"
        onCommit={onCommit}
        control="select"
        options={[
          { value: "article", label: "Article" },
          { value: "review", label: "Review" },
        ]}
      />,
    );

    await user.click(screen.getByText("article"));
    await user.keyboard("{Escape}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("article")).toBeInTheDocument();
  });
});
