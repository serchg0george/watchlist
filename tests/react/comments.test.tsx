import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Comments } from "../../src/ui/react/Comments.js";
import { state } from "../../src/state/store.js";
import { renderLive, seed } from "./harness.js";

afterEach(cleanup);

describe("Comments", () => {
  test("renders both roots and replies in order", () => {
    seed([{ id: "a", title: "T", status: "watched", comments: { S: "Root S", L: "Root L" },
      replies: [{ id: "r1", to: "S", by: "L", text: "Reply to S", at: "2026-11-01T10:00:00Z" }] }]);
    const { container } = renderLive(() => <Comments item={state.data!.items[0]!} canEdit={false} />);
    expect([...container.querySelectorAll(".comment-text")].map((n) => n.textContent)).toEqual(["Root S", "Reply to S", "Root L"]);
  });

  test("own empty comment shows an add button that opens the editor", () => {
    seed([{ id: "a", title: "T", status: "watched" }], { token: "t", login: "x", person: "S" });
    renderLive(() => <Comments item={state.data!.items[0]!} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "💬 Комментарий" }));
    expect(screen.getByRole("textbox", { name: "Комментарий S" })).toBeTruthy();
  });
});
