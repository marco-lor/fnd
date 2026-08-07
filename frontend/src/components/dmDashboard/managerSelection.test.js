import { reconcileManagerUserSelection } from "./managerSelection";

describe("reconcileManagerUserSelection", () => {
  test("selects every user on the first populated load", () => {
    expect(reconcileManagerUserSelection({
      selectedUserIds: [],
      currentUserIds: ["a", "b"],
      previousUserIds: [],
      isInitialLoad: true,
    })).toEqual(["a", "b"]);
  });

  test("preserves a manual selection across realtime data updates", () => {
    expect(reconcileManagerUserSelection({
      selectedUserIds: ["b"],
      currentUserIds: ["a", "b", "c"],
      previousUserIds: ["a", "b", "c"],
    })).toEqual(["b"]);
  });

  test("removes missing users and selects only genuinely new users", () => {
    expect(reconcileManagerUserSelection({
      selectedUserIds: ["a", "b"],
      currentUserIds: ["b", "c"],
      previousUserIds: ["a", "b"],
    })).toEqual(["b", "c"]);
  });
});
