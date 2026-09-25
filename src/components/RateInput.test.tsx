// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RateInput } from "./RateInput";

afterEach(cleanup);

describe("RateInput", () => {
  it("resets to 8,000 and shows the message when blurred below the minimum (AC3)", () => {
    const onChange = vi.fn();
    render(<RateInput value={8200} onChange={onChange} />);
    const input = screen.getByLabelText("Order rate") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "7999" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(8000);
    expect(input.value).toBe("8000");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Rate can't be below 8,000 SDG/USD — reset to the minimum.",
    );
  });

  it("accepts a valid rate on blur without resetting", () => {
    const onChange = vi.fn();
    render(<RateInput value={8200} onChange={onChange} />);
    const input = screen.getByLabelText("Order rate") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "9000" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(9000);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the global default helper text when it differs from the current value", () => {
    render(<RateInput value={9000} defaultValue={8200} onChange={() => {}} />);
    expect(screen.getByText("Today's default: 8,200 SDG/USD")).toBeInTheDocument();
  });
});
