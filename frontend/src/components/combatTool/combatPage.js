import React, { useEffect, useMemo, useState } from "react";
import { GoSidebarCollapse, GoSidebarExpand } from "react-icons/go";
import { useAuth } from "../../AuthContext";
import EncounterCreator from "./elements/EncounterCreator";
import EncounterSidebarList from "./elements/EncounterSidebarList";
import EncounterDetails from "./elements/EncounterDetails";
import EncounterLog from "./elements/EncounterLog";
import { Section } from "./elements/ui";

const CombatPage = () => {
	const { user, userData } = useAuth();
	const isDM = (userData?.role || "") === "dm"; // Webmaster is NOT treated as DM here

	const [selectedEncounter, setSelectedEncounter] = useState(null);
	// Collapsible left panel (encounters + creator)
	const [leftCollapsed, setLeftCollapsed] = useState(() => {
		try {
			const saved = localStorage.getItem("combat.leftCollapsed");
			return saved === "true";
		} catch (_) {
			return false;
		}
	});

	useEffect(() => {
		try {
			localStorage.setItem("combat.leftCollapsed", String(leftCollapsed));
		} catch (_) {}
	}, [leftCollapsed]);

	const toggleLeft = () => setLeftCollapsed((v) => !v);

	const gridCols = useMemo(() => {
		// Smoothly animate the grid template when collapsing the left panel.
		// Keep three columns at md+; shrink left to 0 when collapsed so center expands.
		return leftCollapsed
			? "grid grid-cols-1 md:grid-cols-[0rem_1fr_20rem]"
			: "grid grid-cols-1 md:grid-cols-[20rem_1fr_20rem]";
	}, [leftCollapsed]);

	return (
		<div className="relative w-full min-h-screen overflow-hidden">
			{/* Background overlay similar to Home */}
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_60%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.04),transparent_65%)] mix-blend-overlay" />

			<div className="relative z-10 flex flex-col h-full">
				<header className="px-6 pt-6">
					<h1 className="text-2xl font-semibold text-slate-100">Combat Tool</h1>
				</header>

				<main className="flex-1 px-6 pb-6 pt-4 w-full">
					{!user && <div className="text-slate-300">Please log in to access encounters.</div>}

						{user && (
							<div
								className={`${gridCols} gap-y-6 ${leftCollapsed ? "md:gap-x-0" : "md:gap-x-6"} items-start transition-[grid-template-columns] duration-300 ease-in-out`}
							>
								{/* Left sidebar: creator (DM) + encounters list */}
								<div
									className={`md:sticky md:top-0 md:self-start md:max-h-[calc(100vh-5rem)] overflow-y-auto pr-1 ${
										leftCollapsed ? "opacity-0 pointer-events-none -translate-x-2" : "opacity-100 translate-x-0"
									} transition-all duration-300 ease-in-out`}
								>
									{isDM && (
										<EncounterCreator
											isDM={isDM}
											currentUid={user.uid}
											collapseControl={
                            <button
                                onClick={toggleLeft}
                                title={leftCollapsed ? "Mostra pannello" : "Nascondi pannello"}
                                aria-label={leftCollapsed ? "Mostra pannello incontri" : "Nascondi pannello incontri"}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800/80 text-slate-100 border border-slate-600/60 hover:bg-slate-800/60 transition"
                            >
                                {leftCollapsed ? <GoSidebarExpand /> : <GoSidebarCollapse />}
                            </button>
											}
										/>
									)}
									<EncounterSidebarList
										isDM={isDM}
										onSelect={setSelectedEncounter}
										selectedId={selectedEncounter?.id}
										actions={
											!isDM && (
                            <button
                                onClick={toggleLeft}
                                title={leftCollapsed ? "Mostra pannello" : "Nascondi pannello"}
                                aria-label={leftCollapsed ? "Mostra pannello incontri" : "Nascondi pannello incontri"}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800/80 text-slate-100 border border-slate-600/60 hover:bg-slate-800/60 transition"
                            >
                                {leftCollapsed ? <GoSidebarExpand /> : <GoSidebarCollapse />}
                            </button>
											)
										}
									/>
								</div>

								{/* Main content */}
								<div className="min-h-[50vh]">
									{selectedEncounter ? (
										<Section title={selectedEncounter.name || "Encounter"}>
											<EncounterDetails encounter={selectedEncounter} isDM={isDM} />
										</Section>
									) : (
										<Section title="Encounter Details">
											<div className="text-slate-400">Seleziona un incontro dalla lista a sinistra.</div>
										</Section>
									)}
								</div>

								{/* Right sidebar: encounter log */}
								<div className="md:sticky md:top-0 md:self-start md:max-h-[calc(100vh-5rem)] overflow-y-auto pr-1">
									<EncounterLog encounterId={selectedEncounter?.id} />
								</div>
							</div>
						)}
				</main>
			</div>

			{/* Floating handle to reopen when collapsed (MD+) */}
			{user && leftCollapsed && (
                <button
                    onClick={toggleLeft}
                    className="flex items-center gap-2 fixed left-2 top-40 z-[60] px-3 py-2 rounded-xl bg-gradient-to-br from-indigo-600/80 to-violet-600/80 text-white shadow-lg hover:shadow-indigo-900/30 transition"
                    title="Mostra pannello incontri"
                >
                    <GoSidebarExpand />
                </button>
			)}
		</div>
	);
};

export default CombatPage;

