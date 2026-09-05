import React from "react";
import { render, screen } from "@testing-library/react";
import CharacterDetails from "./CharacterDetails";

describe("CharacterDetails legacy profile safety", () => {
  test("renders partial legacy Anima data without dereferencing missing media or bonus fields", () => {
    render(
      <CharacterDetails
        characterName="legacy-player"
        setCharacterName={jest.fn()}
        imageFile={null}
        imagePreview=""
        handleImageChange={jest.fn()}
        selectedRace={null}
        selectedAnima={{
          name: "Legacy Anima",
          bonuses: null,
          levelUpBonus: "not-an-object",
        }}
        error=""
      />
    );

    expect(screen.getByText("Legacy Anima")).toBeInTheDocument();
    expect(screen.getByText("Initial Bonuses:")).toBeInTheDocument();
    expect(screen.queryByText("Level Up Bonuses (per level):")).not.toBeInTheDocument();
  });
});
