import { fireEvent, render, screen } from "@testing-library/react";
import ManagerActionDialog, { parseIntegerInput } from "./ManagerActionDialog";

describe("ManagerActionDialog", () => {
  test("parses only complete safe integers", () => {
    expect(parseIntegerInput("-12")).toBe(-12);
    expect(parseIntegerInput(" +7 ")).toBe(7);
    expect(parseIntegerInput("1.5")).toBeNull();
    expect(parseIntegerInput("2 tokens")).toBeNull();
    expect(parseIntegerInput("")).toBeNull();
    expect(parseIntegerInput("9007199254740992")).toBeNull();
  });

  test("submits the in-page confirmation dialog", () => {
    const onConfirm = jest.fn();
    render(
      <ManagerActionDialog
        visible
        title="Confirm action"
        description="Review this action."
        confirmLabel="Apply"
        onClose={jest.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("edits numeric input and cancels without submitting", () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    render(
      <ManagerActionDialog
        visible
        title="Adjust tokens"
        inputLabel="Token delta"
        value="1"
        onChange={onChange}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Token delta" }), {
      target: { value: "-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).toHaveBeenCalledWith("-2");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
