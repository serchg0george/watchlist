import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Stats } from "../../src/ui/react/Stats.js";
import { renderLive, seed } from "./harness.js";

const ITEMS = [
  { id: "a", title: "Half", status: "watched", watchedAt: "2026-11-05", ratings: { S: 7.5, L: 9 }, genres: ["Drama"] },
  { id: "b", title: "Whole", status: "watched", watchedAt: "2026-11-06", ratings: { S: 6, L: 6 } }
];
const KEY = "watchlist.statsView";

const sections = (container: HTMLElement): string[] => [...container.querySelectorAll(".stack > section")].map((s) => s.className.replace("card ", ""));

function mount() {
  seed(ITEMS, { tab: "stats" });
  return renderLive(() => <Stats hidden={false} />);
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("Stats", () => {
  test("tabs come in the planned order with ARIA wiring", () => {
    mount();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Обзор", "Оценки", "Топ", "Споры", "По месяцам", "Жанры"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0]!.id);
    expect(tabs.every((t) => t.getAttribute("aria-controls") === panel.id)).toBe(true);
  });

  test("each tab shows its own sections", () => {
    const { container } = mount();
    const expected: [string, string[]][] = [
      ["Обзор", ["hero", "sec-favorite", "sec-cats"]],
      ["Оценки", ["sec-hist", "sec-scatter"]],
      ["Топ", ["sec-top"]],
      ["Споры", ["sec-diff"]],
      ["По месяцам", ["sec-months"]],
      ["Жанры", ["sec-genres"]]
    ];
    for (const [name, order] of expected) {
      fireEvent.click(screen.getByRole("tab", { name }));
      expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe("true");
      expect(sections(container)).toEqual(order);
    }
  });

  test("ratings use a comma", () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole("tab", { name: "Споры" }));
    expect(container.querySelector(".sec-diff .pair")?.textContent).toBe("S 7,5L 9");
  });

  test("arrow keys, Home and End move between tabs", () => {
    mount();
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    fireEvent.keyDown(tabs[1]!, { key: "ArrowLeft" });
    fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
    expect(tabs[5]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[5]!, { key: "Home" });
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0]!, { key: "End" });
    expect(tabs[5]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[5]!.tabIndex).toBe(0);
    expect(tabs[0]!.tabIndex).toBe(-1);
  });

  test("the chosen tab is remembered across reloads", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Топ" }));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toBe("top");
    cleanup();
    mount();
    expect(screen.getByRole("tab", { name: "Топ" }).getAttribute("aria-selected")).toBe("true");
  });

  test("unknown stored value falls back to overview", () => {
    localStorage.setItem(KEY, JSON.stringify("nope"));
    mount();
    expect(screen.getByRole("tab", { name: "Обзор" }).getAttribute("aria-selected")).toBe("true");
  });
});
