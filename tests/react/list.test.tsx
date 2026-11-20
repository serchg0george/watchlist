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
});
