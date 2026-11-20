import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Stars } from "../../src/ui/react/Stars.js";

afterEach(cleanup);

describe("Stars", () => {
  test("fills full, half and empty stars and shows the value with a comma", () => {
    const { container } = render(<Stars person="S" value={7.5} editable={false} onRate={() => {}} />);
    const stars = [...container.querySelectorAll(".star")];
    expect(stars.filter((s) => s.classList.contains("on"))).toHaveLength(7);
    expect(stars[7]?.classList.contains("half")).toBe(true);
    expect(stars.slice(8).every((s) => !s.classList.contains("on") && !s.classList.contains("half"))).toBe(true);
    expect(container.querySelector(".rating-value")?.textContent).toBe("7,5");
  });

  test("shows a dash without a rating", () => {
    const { container } = render(<Stars person="L" value={null} editable={false} onRate={() => {}} />);
    expect(container.querySelector(".rating-value")?.textContent).toBe("—");
  });

  test("left half rates i - 0.5, right half rates i", () => {
    const onRate = vi.fn();
    render(<Stars person="S" value={null} editable onRate={onRate} />);
    fireEvent.click(screen.getByRole("button", { name: "S: 6,5 из 10" }));
    fireEvent.click(screen.getByRole("button", { name: "S: 7 из 10" }));
    expect(onRate.mock.calls).toEqual([[6.5], [7]]);
  });
});
