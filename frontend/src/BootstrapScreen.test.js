import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BootstrapScreen from "./BootstrapScreen";

test("shows deterministic bootstrap phases and a recoverable error", () => {
  const retry = jest.fn();
  const { rerender } = render(<BootstrapScreen phase="config-loading" />);
  expect(screen.getByText("Loading application configuration…")).toBeInTheDocument();
  expect(screen.getByTestId("bootstrap-screen")).toHaveAttribute("aria-busy", "true");

  rerender(<BootstrapScreen phase="error" onRetry={retry} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("bootstrap-screen")).toHaveAttribute("aria-busy", "false");
});
