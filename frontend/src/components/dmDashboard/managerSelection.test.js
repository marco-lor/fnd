import { reconcileManagerUserSelection } from "./managerSelection";

describe("reconcileManagerUserSelection", () => {
  test("selects every user on the first populated load", () => {
    expect(reconcileManagerUserSelection({
      selectedUserIds: new Set([]),
      currentUserIds: ["a", "b"],
      previousUserIds: [],
      isInitialLoad: true,
    })).toEqual(new Set(["a", "b"]));
  });

  test("preserves a manual selection across realtime data updates", () => {
    expect(reconcileManagerUserSelection({
      selectedUserIds: new Set(["b"]),
      currentUserIds: ["a", "b", "c"],
      previousUserIds: ["a", "b", "c"],
    })).toEqual(new Set(["b"]));
  });

  test("preserves Set identity for unchanged membership", () => {
    const selected = new Set(['a']);
    expect(reconcileManagerUserSelection({selectedUserIds: selected, currentUserIds: ['a', 'b'], previousUserIds: ['a', 'b']})).toBe(selected);
  });
  test("removes missing users and selects only genuinely new users", () => {
    expect(reconcileManagerUserSelection({
      selectedUserIds: new Set(["a", "b"]),
      currentUserIds: ["b", "c"],
      previousUserIds: ["a", "b"],
    })).toEqual(new Set(["b", "c"]));
  });
});
