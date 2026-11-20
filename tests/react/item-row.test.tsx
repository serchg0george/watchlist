import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ItemRow } from "../../src/ui/react/ItemRow.js";
import { state } from "../../src/state/store.js";
import { renderLive, seed } from "./harness.js";

afterEach(cleanup);

const tmdb = { id: 1, mediaType: "movie", overview: "Long overview", year: 2020 };

describe("ItemRow", () => {
  test("watched card is expanded: full overview without clamp, ratings and comments", () => {
    seed([{ id: "w", title: "Seen", status: "watched", ratings: { S: 8, L: 7.5 }, comments: { S: "Good", L: "" }, tmdb }]);
    const { container } = renderLive(() => <ItemRow item={state.data!.items[0]!} />);
    expect(container.querySelector(".catalog-overview")?.classList.contains("clamp")).toBe(false);
    expect(container.querySelector(".overview-toggle")).toBeNull();
    expect(container.querySelectorAll(".rating-line")).toHaveLength(2);
    expect(screen.getByText("Good")).toBeTruthy();
  });

  test("collapse toggle hides the body and survives re-renders", () => {
    seed([{ id: "w", title: "Seen", status: "watched", ratings: { S: 8, L: null }, tmdb }]);
    const { container } = renderLive(() => <ItemRow item={state.data!.items[0]!} />);
    const toggle = screen.getByRole("button", { name: "Свернуть" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(container.querySelector(".item-body")).toBeNull();
    expect(screen.getByRole("button", { name: "Развернуть" }).getAttribute("aria-expanded")).toBe("false");
  });

  test("other statuses keep the clamped overview and have no collapse toggle", () => {
    seed([{ id: "p", title: "Later", status: "planned", tmdb }]);
    const { container } = renderLive(() => <ItemRow item={state.data!.items[0]!} />);
    expect(container.querySelector(".catalog-overview")?.classList.contains("clamp")).toBe(true);
    expect(container.querySelector(".card-toggle")).toBeNull();
  });
});
