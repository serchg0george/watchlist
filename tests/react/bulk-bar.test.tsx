import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { BulkBar } from "../../src/ui/react/BulkBar.js";
import { selectedIds, state, visibleIds } from "../../src/state/store.js";
import { renderLive, seed } from "./harness.js";

afterEach(cleanup);

describe("BulkBar", () => {
  test("is hidden outside selection mode", () => {
    seed([{ id: "a", title: "A" }]);
    const { container } = renderLive(() => <BulkBar />);
    expect((container.querySelector("#bulk-bar") as HTMLElement).hidden).toBe(true);
  });

  test("counts the selection and selects all visible items", () => {
    seed([{ id: "a", title: "A" }, { id: "b", title: "B" }], { selecting: true, token: "t" });
    visibleIds.splice(0, visibleIds.length, "a", "b");
    selectedIds.add("a");
    renderLive(() => <BulkBar />);
    expect(screen.getByText("Выбрано: 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Все видимые" }));
    expect(screen.getByText("Выбрано: 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    expect(state.selecting).toBe(false);
  });
});
