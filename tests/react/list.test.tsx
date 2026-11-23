import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ListTab } from "../../src/ui/react/ListTab.js";
import { computeListView } from "../../src/ui/react/listView.js";
import { state } from "../../src/state/store.js";
import { renderLive, seed } from "./harness.js";

afterEach(cleanup);

const items = [
  { id: "p", title: "Planned one", status: "planned" },
  { id: "g", title: "Going", status: "watching" },
  { id: "w", title: "Done", status: "watched" }
];

describe("ListTab", () => {
  test("chips filter planned vs watching and show counts", () => {
    seed(items);
    const { container } = renderLive(() => <ListTab view={computeListView()} hidden={false} />);
    expect([...container.querySelectorAll(".item-title")].map((n) => n.textContent)).toEqual(["Planned one"]);
    fireEvent.click(screen.getByRole("button", { name: /Смотрим/ }));
    expect(state.statusFilter).toBe("watching");
    expect([...container.querySelectorAll(".item-title")].map((n) => n.textContent)).toEqual(["Going"]);
    expect(container.querySelector('.chip[data-key="all"] .count')?.textContent).toBe("1");
  });

  test("search narrows the list and shows the empty message", () => {
    seed(items);
    renderLive(() => <ListTab view={computeListView()} hidden={false} />);
    fireEvent.change(screen.getByPlaceholderText("Поиск…"), { target: { value: "nothing" } });
    expect(screen.getByText("Ничего не найдено")).toBeTruthy();
  });

  test("watched tab lists watched items", () => {
    seed(items, { tab: "watched" });
    const { container } = renderLive(() => <ListTab view={computeListView()} hidden={false} />);
    expect([...container.querySelectorAll(".item-title")].map((n) => n.textContent)).toEqual(["Done"]);
  });

  test("watched tab: same watchedAt is ordered by statusAt, not addedAt", () => {
    seed([
      { id: "late", title: "Added later", status: "watched", addedAt: "2026-11-20", watchedAt: "2026-11-22", statusAt: "2026-11-22T09:00:00.000Z" },
      { id: "early", title: "Added earlier", status: "watched", addedAt: "2026-11-01", watchedAt: "2026-11-22", statusAt: "2026-11-22T21:00:00.000Z" },
      { id: "old", title: "Older", status: "watched", addedAt: "2026-11-21", watchedAt: "2026-11-10" }
    ], { tab: "watched" });
    const { container } = renderLive(() => <ListTab view={computeListView()} hidden={false} />);
    expect([...container.querySelectorAll(".item-title")].map((n) => n.textContent)).toEqual(["Added earlier", "Added later", "Older"]);
  });

  test("dropped tab sorts by droppedAt and has its own sort state", () => {
    seed([
      { id: "a", title: "A", status: "dropped", addedAt: "2026-11-01", droppedAt: "2026-11-05" },
      { id: "b", title: "B", status: "dropped", addedAt: "2026-11-02", droppedAt: "2026-11-09" }
    ], { tab: "dropped" });
    const { container } = renderLive(() => <ListTab view={computeListView()} hidden={false} />);
    expect([...container.querySelectorAll(".item-title")].map((n) => n.textContent)).toEqual(["B", "A"]);
    fireEvent.change(screen.getByLabelText("Сортировка"), { target: { value: "title-asc" } });
    expect(state.finishedSort).toBe("title-asc");
    expect(state.sort).toBe("added-desc");
    expect([...container.querySelectorAll(".item-title")].map((n) => n.textContent)).toEqual(["A", "B"]);
  });
});
