import React from "react";
import { render, screen } from "@testing-library/react";
import AnimaShardSelection from "./AnimaShardSelection";
import { getVarie } from "../../../data/configRepository";

jest.mock("../../../data/configRepository", () => ({
  getVarie: jest.fn(),
}));

describe("AnimaShardSelection shared-data boundary", () => {
  test("renders a transport error and leaves retry available", () => {
    const retry = jest.fn();
    render(<AnimaShardSelection varieStatus="error" varieError={new Error('Varie unavailable')}
      onRetry={retry} onAnimaSelect={() => {}} />);
    expect(screen.getAllByText('Varie unavailable')).toHaveLength(2);
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
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
