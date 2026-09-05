import React from "react";

// Always-available placeholder race with no creation bonuses.
const PLACEHOLDER_RACE = {
  id: "Evocazione Permanente",
  description:
    "Placeholder per evocazioni permanenti. Nessun bonus di creazione. Usa Anima e i costi di distribuzione punti standard.",
};

const isRecord = (value) => (
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
);

function RaceSelection({
  onRaceSelect,
  selectedRace,
  codexData,
  codexStatus,
  disabled = false,
}) {
  const effectiveStatus = codexStatus || (codexData ? "ready" : "missing");
  const raceMap = effectiveStatus === "ready" && isRecord(codexData?.Razze)
    ? codexData.Razze
    : null;
  const racesArray = raceMap
    ? Object.entries(raceMap).map(([raceName, descriptionString]) => ({
      id: raceName,
      description: typeof descriptionString === "string" ? descriptionString : "",
    }))
    : [];
  const hasPlaceholder = racesArray.some((race) => race.id === PLACEHOLDER_RACE.id);
  const races = hasPlaceholder ? racesArray : [...racesArray, PLACEHOLDER_RACE];

  if (effectiveStatus === "loading") {
    return (
      <div className="w-full">
        <label className="block text-white text-left mb-3 text-sm font-medium">
          Select Your Race
        </label>
        <div className="col-span-full text-center py-6 text-white/60">
          Loading races...
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <label className="block text-white text-left mb-3 text-sm font-medium">
        Select Your Race
      </label>
      {(effectiveStatus === "missing" || effectiveStatus === "malformed") && (
        <div role="alert" className="mb-4 text-amber-200 text-left">
          Race data is {effectiveStatus === "missing" ? "missing" : "malformed"}; the permanent-summoning placeholder remains available.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {races.length === 0 ? (
          <div className="col-span-full text-center py-6 text-red-400">
            No races available. Please contact the game administrator.
          </div>
        ) : races.map((race) => (
          <button
            type="button"
            key={race.id}
            className={`p-4 rounded-lg cursor-pointer transition-all duration-300 text-left h-full flex flex-col ${
              selectedRace?.id === race.id
                ? 'bg-blue-700/70 border-2 border-blue-400 shadow-[0_0_10px_rgba(100,150,255,0.7)] scale-95'
                : 'bg-[rgba(40,40,60,0.7)] border border-[rgba(150,150,255,0.2)] hover:bg-[rgba(60,60,80,0.7)] hover:scale-102'
            }`}
            onClick={() => {
              if (!disabled) onRaceSelect(race);
            }}
            disabled={disabled}
            aria-busy={disabled || undefined}
          >
            <h3 className="text-lg font-semibold text-[#D4AF37] mb-2">{race.id}</h3>
            {race.description && (
              <p className="text-white/80 text-sm mb-2 whitespace-pre-line flex-grow">
                {race.description}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export { PLACEHOLDER_RACE };
export default RaceSelection;
