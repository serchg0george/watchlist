import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Stats } from "../../src/ui/react/Stats.js";
import { renderLive, seed } from "./harness.js";

afterEach(cleanup);

describe("Stats", () => {
  test("sections follow the planned order and ratings use a comma", () => {
    seed([
      { id: "a", title: "Half", status: "watched", watchedAt: "2026-11-05", ratings: { S: 7.5, L: 9 }, genres: ["Drama"] },
      { id: "b", title: "Whole", status: "watched", watchedAt: "2026-11-06", ratings: { S: 6, L: 6 } }
    ], { tab: "stats" });
    const { container } = renderLive(() => <Stats hidden={false} />);
    const order = [...container.querySelectorAll(".stack > section")].map((s) => s.className.replace("card ", ""));
    expect(order).toEqual(["hero", "sec-hist", "sec-months", "sec-scatter", "sec-cats", "sec-top", "sec-favorite", "sec-diff"]);
    expect(container.querySelector(".sec-diff .pair")?.textContent).toBe("S 7,5L 9");
  });

  test("switching to genres view displays only genres section with active tab", () => {
    seed([
      { id: "a", title: "Half", status: "watched", watchedAt: "2026-11-05", ratings: { S: 7.5, L: 9 }, genres: ["Drama"] },
      { id: "b", title: "Whole", status: "watched", watchedAt: "2026-11-06", ratings: { S: 6, L: 6 } }
    ], { tab: "stats" });
    const { container } = renderLive(() => <Stats hidden={false} />);
    const genresTab = screen.getByRole("tab", { name: "Совпадение по жанрам" });
    fireEvent.click(genresTab);
    expect(genresTab.getAttribute("aria-selected")).toBe("true");
    const order = [...container.querySelectorAll(".stack > section")].map((s) => s.className.replace("card ", ""));
    expect(order).toEqual(["sec-genres"]);
  });
});
