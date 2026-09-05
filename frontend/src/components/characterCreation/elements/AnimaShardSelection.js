import React from "react";

const isRecord = (value) => (
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
);

function AnimaShardSelection({
  onAnimaSelect,
  selectedAnima,
  varieData,
  varieStatus,
  varieError,
  onRetry,
  disabled = false,
}) {
  const effectiveStatus = varieStatus || (varieData ? "ready" : "missing");
  const animaShards = effectiveStatus === "ready" && isRecord(varieData?.modAnima)
    ? varieData.modAnima
    : {};
  const levelUpBonuses = isRecord(varieData?.levelUpAnimaBonus)
    ? varieData.levelUpAnimaBonus
    : {};

  const error = effectiveStatus === "missing"
    ? "Could not find the Anima Shard configuration in the database."
    : effectiveStatus === "malformed"
      ? "Anima shard data format is incorrect in the database."
      : effectiveStatus === "error"
        ? (typeof varieError === 'string' ? varieError : varieError?.message)
          || "Failed to fetch anima shard data."
        : "";

  const handleAnimaSelect = (animaName, bonuses) => {
    const levelUpBonus = isRecord(levelUpBonuses[animaName])
      ? levelUpBonuses[animaName]
      : {};
    onAnimaSelect({
      name: animaName,
      bonuses,
      levelUpBonus,
    });
  };

  const formatBonuses = (bonuses) => (
    Object.entries(isRecord(bonuses) ? bonuses : {}).map(([param, value]) => (
      <span key={param} className="block">
        <span className="font-medium text-yellow-300">{param}:</span> +{value}
      </span>
    ))
  );

  const renderAnimaSelection = () => {
    if (effectiveStatus === "loading") {
      return (
        <div className="col-span-full text-center py-6 text-white/60">
          Loading anima shards...
        </div>
      );
    }

    if (Object.keys(animaShards).length === 0) {
      return (
        <div className="col-span-full text-center py-6 text-red-400">
          {error || "No anima shards available. Please contact the game administrator."}
        </div>
      );
    }

    return Object.entries(animaShards).map(([animaName, bonuses]) => {
      const levelBonus = isRecord(levelUpBonuses[animaName])
        ? levelUpBonuses[animaName]
        : {};

      return (
        <button
          type="button"
          key={animaName}
          className={`p-4 rounded-lg cursor-pointer transition-all duration-300 text-left h-full flex flex-col ${
            selectedAnima?.name === animaName
              ? 'bg-blue-700/70 border-2 border-blue-400 shadow-[0_0_10px_rgba(100,150,255,0.7)] scale-105'
              : 'bg-[rgba(40,40,60,0.7)] border border-[rgba(150,150,255,0.2)] hover:bg-[rgba(60,60,80,0.7)] hover:scale-102'
          }`}
          onClick={() => {
            if (!disabled) handleAnimaSelect(animaName, bonuses);
          }}
          disabled={disabled}
          aria-busy={disabled || undefined}
        >
          <h3 className="text-lg font-semibold text-[#D4AF37] mb-2">{animaName}</h3>
          <div className="text-white/80 text-sm mb-3">
            <p className="mb-1 font-medium text-blue-300">Initial Bonuses:</p>
            {formatBonuses(bonuses)}
          </div>
          <div className="text-white/80 text-sm mt-auto pt-2 border-t border-white/20">
            <p className="mb-1 font-medium text-green-300">Level Up Bonus:</p>
            {Object.keys(levelBonus).length > 0 ? (
              formatBonuses(levelBonus)
            ) : (
              <span className="text-white/50">No level bonus data available.</span>
            )}
            <p className="mt-2 text-xs text-white/50 italic">
              This bonus is applied each time you level up.
            </p>
          </div>
        </button>
      );
    });
  };

  return (
    <div className="w-full">
      <label className="block text-white text-left mb-3 text-sm font-medium">
        Select Your Anima Shard
      </label>
      <p className="text-white/70 text-sm mb-4 text-left">
        Each Anima Shard grants different parameter bonuses that will shape your character's abilities,
        and provides additional bonuses each time you level up. Choose wisely based on your preferred playstyle.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {renderAnimaSelection()}
      </div>
      {error && effectiveStatus !== "loading" && Object.keys(animaShards).length === 0 && (
        <div className="w-full mt-4 p-3 bg-red-900/60 border border-red-700 rounded text-white text-sm shadow-md">
          {error}
        </div>
      )}
      {effectiveStatus === "error" && typeof onRetry === "function" && (
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          className="mt-4 px-4 py-2 bg-blue-700 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export default AnimaShardSelection;
