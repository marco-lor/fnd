import React from "react";
import { render, screen } from "@testing-library/react";
import AnimaShardSelection from "./AnimaShardSelection";
import { getVarie } from "../../../data/configRepository";

jest.mock("../../../data/configRepository", () => ({
  getVarie: jest.fn(),
}));

describe("AnimaShardSelection shared-data boundary", () => {
  beforeEach(() => {
    getVarie.mockReset();
    getVarie.mockReturnValue(new Promise(() => {}));
  });

  test("renders injected Anima data without starting a child-owned read", () => {
    render(
      <AnimaShardSelection
        user={{ uid: "player-a" }}
        varieData={{
          modAnima: { Spirito: { Saggezza: 2 } },
          levelUpAnimaBonus: { Spirito: { Saggezza: 1 } },
        }}
        selectedAnima={null}
        onAnimaSelect={() => {}}
      />
    );

    expect(screen.getByText("Spirito")).toBeInTheDocument();
    expect(getVarie).not.toHaveBeenCalled();
  });

  test("distinguishes missing shared data from a transport failure", () => {
    render(
      <AnimaShardSelection
        user={{ uid: "player-a" }}
        varieData={null}
        varieStatus="missing"
        selectedAnima={null}
        onAnimaSelect={() => {}}
      />
    );

    expect(screen.getAllByText("Could not find the Anima Shard configuration in the database.")).toHaveLength(2);
    expect(getVarie).not.toHaveBeenCalled();
  });
});
