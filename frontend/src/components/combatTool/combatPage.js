import React, { useState } from "react";
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
							<div className="grid grid-cols-1 md:grid-cols-[20rem_1fr_20rem] gap-6 items-start">
							<div className="md:sticky md:top-0 md:self-start md:max-h-[calc(100vh-5rem)] overflow-y-auto pr-1">
								{isDM && <EncounterCreator isDM={isDM} currentUid={user.uid} />}
								<EncounterSidebarList
									isDM={isDM}
									onSelect={setSelectedEncounter}
									selectedId={selectedEncounter?.id}
								/>
							</div>
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
								<div className="md:sticky md:top-0 md:self-start md:max-h-[calc(100vh-5rem)] overflow-y-auto pr-1">
									<EncounterLog encounterId={selectedEncounter?.id} />
								</div>
						</div>
					)}
				</main>
			</div>
		</div>
	);
};

export default CombatPage;

