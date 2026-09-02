import React from "react";
import { render, screen } from "@testing-library/react";
import RaceSelection from "./RaceSelection";
import { getCodex } from "../../../data/codexRepository";

jest.mock("../../../data/codexRepository", () => ({
  getCodex: jest.fn(),
}));

describe("RaceSelection shared-data boundary", () => {
  beforeEach(() => {
    getCodex.mockReset();
    getCodex.mockReturnValue(new Promise(() => {}));
  });

  test("renders the injected codex without starting a child-owned read", () => {
    render(
      <RaceSelection
        user={{ uid: "player-a" }}
        codexData={{ Razze: { Elfo: "Agile and perceptive." } }}
        selectedRace={null}
        onRaceSelect={() => {}}
      />
    );

    expect(screen.getByText("Elfo")).toBeInTheDocument();
    expect(screen.getByText("Evocazione Permanente")).toBeInTheDocument();
    expect(getCodex).not.toHaveBeenCalled();
  });

  test("keeps the legacy placeholder behavior for absent codex data", () => {
    render(
      <RaceSelection
        user={{ uid: "player-a" }}
        codexData={null}
        codexStatus="missing"
        selectedRace={null}
        onRaceSelect={() => {}}
      />
    );

    expect(screen.getByText("Evocazione Permanente")).toBeInTheDocument();
    expect(getCodex).not.toHaveBeenCalled();
  });
});
