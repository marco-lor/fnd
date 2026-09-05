import React, { useCallback, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import LoginCreateButton from "./LoginCreateButton";

let profilerRenderCount = 0;

jest.mock("../performance/PerformanceProfiler", () => ({ id, children }) => {
  if (id === "LoginCreateButton") profilerRenderCount += 1;
  return <>{children}</>;
});

describe("LoginCreateButton", () => {
  beforeEach(() => {
    profilerRenderCount = 0;
  });

  test("keeps its hover animation local to the button", () => {
    render(<LoginCreateButton handleCreate={jest.fn()} isCreatingAccount={false} />);
    const button = screen.getByRole("button", { name: "Create" });
    const liquidCloud = button.firstElementChild;

    expect(liquidCloud).toHaveStyle({ transform: "scale(1)" });
    fireEvent.mouseEnter(button);
    expect(liquidCloud).toHaveStyle({ transform: "scale(0.8)" });
    fireEvent.mouseLeave(button);
    expect(liquidCloud).toHaveStyle({ transform: "scale(1)" });
  });

  test("honors a shared in-flight disabled state", () => {
    render(
      <LoginCreateButton
        handleCreate={jest.fn()}
        isCreatingAccount={false}
        disabled
      />
    );

    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  test("preserves its loading indicator while the request is owned by Create", () => {
    render(
      <LoginCreateButton
        handleCreate={jest.fn()}
        isCreatingAccount
      />
    );

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).toBeInTheDocument();
  });

  test("uses the production memoized export to isolate stable parent updates", () => {
    const Parent = () => {
      const [parentTick, setParentTick] = useState(0);
      const handleCreate = useCallback(() => {}, []);
      return (
        <>
          <LoginCreateButton handleCreate={handleCreate} isCreatingAccount={false} />
          <button type="button" onClick={() => setParentTick((tick) => tick + 1)}>
            Parent update {parentTick}
          </button>
        </>
      );
    };

    render(<Parent />);
    expect(profilerRenderCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /Parent update/ }));
    expect(profilerRenderCount).toBe(1);
  });
});
