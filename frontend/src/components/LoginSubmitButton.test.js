import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import LoginSubmitButton from "./LoginSubmitButton";

describe("LoginSubmitButton", () => {
  test("preserves hover animation and enter label", () => {
    render(<LoginSubmitButton isLoggingIn={false} />);
    const button = screen.getByRole("button");
    const cloud = button.firstChild;

    expect(cloud).toHaveStyle({ transform: "scale(1)" });
    fireEvent.mouseEnter(button);
    expect(cloud).toHaveStyle({ transform: "scale(0.8)" });
    expect(screen.getByText("Enter")).toBeInTheDocument();
    fireEvent.mouseLeave(button);
    expect(cloud).toHaveStyle({ transform: "scale(1)" });
  });

  test("shows the loading indicator and disables while signing in", () => {
    render(<LoginSubmitButton isLoggingIn />);
    const button = screen.getByRole("button");

    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByText("Enter")).not.toBeInTheDocument();
  });
});
