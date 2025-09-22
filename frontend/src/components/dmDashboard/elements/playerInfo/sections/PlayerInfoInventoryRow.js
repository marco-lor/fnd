import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import DelInventoryItemOverlay from "../../buttons/delInventoryItem";
import DelVarieItemUnitsOverlay from "../../buttons/delVarieItemUnits";
// DM utility overlay to grant bazaar items for free (no gold deduction)
import AddBazaarItemOverlay from "../overlays/AddBazaarItemOverlay"; // new overlay to grant existing bazaar items

const deriveInventoryId = (entry, index) => {
  if (!entry) return `item-${index}`;
  if (typeof entry === "string") return entry;
  return entry.id || entry.name || entry?.General?.Nome || `item-${index}`;
};

const resolveDisplayName = (entry, index, catalog) => {
  if (!entry) return `item-${index}`;
  if (typeof entry === "string") return catalog[entry] || entry;
  return entry?.General?.Nome || entry.name || (entry.id && catalog[entry.id]) || deriveInventoryId(entry, index);
};

const PlayerInfoInventoryRow = ({ users, catalog, itemsDocs, iconEditClass, onEditInventoryItem, onOpenGoldOverlay, goldUpdating, onAddVarie, canDeleteInventory = true, canGrantBazaar = true }) => {
  const [deleteTarget, setDeleteTarget] = useState(null); // non-varie delete
  const [deleteVarieTarget, setDeleteVarieTarget] = useState(null); // varie delete (with qty)
  const [grantUserId, setGrantUserId] = useState(null); // when set, opens AddBazaarItemOverlay for that user

  return (
    <>
      <tr className="bg-gray-800 hover:bg-gray-700">
        <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Inventario</td>
        {users.map((user) => {
          const inventory = Array.isArray(user?.inventory) ? user.inventory : [];
          const nonVarieInstances = [];
          const varieMap = {};

          for (let i = 0; i < inventory.length; i += 1) {
            const entry = inventory[i];
            if (!entry) continue;
            if (typeof entry === "string") {
              const id = entry;
              const name = catalog[id] || id;
              const type = (itemsDocs[id]?.item_type || itemsDocs[id]?.type || "").toLowerCase();
              if (type === "varie") {
                if (!varieMap[id]) varieMap[id] = { id, name, qty: 0, type: "varie" };
                varieMap[id].qty += 1;
              } else {
                nonVarieInstances.push({ id, name, type: type || "oggetto", invIndex: i });
              }
              continue;
            }
            const id = deriveInventoryId(entry, i);
            const name = resolveDisplayName(entry, i, catalog);
            const type = (entry.type || itemsDocs[id]?.item_type || itemsDocs[id]?.type || "").toLowerCase();
            const qty = typeof entry.qty === "number" ? Math.max(1, entry.qty) : 1;
            if (type === "varie") {
              if (!varieMap[id]) varieMap[id] = { id, name, qty: 0, type: "varie", invIndices: [] };
              varieMap[id].qty += qty;
              // store each contributing inventory index so we could support per-unit deletion in future
              for (let q = 0; q < qty; q += 1) {
                varieMap[id].invIndices.push(i);
              }
            } else {
              for (let q = 0; q < qty; q += 1) {
                nonVarieInstances.push({ id, name, type: type || "oggetto", invIndex: i });
              }
            }
          }

          const seen = {};
          const numbered = nonVarieInstances
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((item) => {
              const count = (seen[item.id] = (seen[item.id] || 0) + 1);
              return { ...item, displayName: count > 1 ? `${item.name} (${count})` : item.name };
            });

          const list = [
            ...numbered,
            ...Object.values(varieMap).sort((a, b) => a.name.localeCompare(b.name)),
          ];

          const gold = typeof user?.stats?.gold === "number" ? user.stats.gold : parseInt(user?.stats?.gold, 10) || 0;
          const goldBusy = !!goldUpdating[user.id];

          return (
            <td key={`${user.id}-inv`} className="border border-gray-600 px-4 py-2 align-top">
              <div className="mb-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/60 bg-slate-900/60 px-3 py-1">
                  <div className="flex items-center gap-1 text-sm text-amber-300">
                    <FontAwesomeIcon icon="coins" className="h-4 w-4" />
                    <span>{gold}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-500/70 text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                      onClick={() => onOpenGoldOverlay(user.id, 1)}
                      disabled={goldBusy}
                      title="Aggiungi gold"
                    >
                      <FontAwesomeIcon icon="plus" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-rose-500/70 text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
                      onClick={() => onOpenGoldOverlay(user.id, -1)}
                      disabled={goldBusy}
                      title="Sottrai gold"
                    >
                      <FontAwesomeIcon icon="minus" className="h-3.5 w-3.5" />
                    </button>
                    {typeof onAddVarie === 'function' && (
                      <button
                        className="ml-1 flex h-7 px-2 items-center justify-center rounded-full border border-indigo-500/70 text-indigo-300 text-[11px] font-medium transition hover:bg-indigo-500/20 disabled:opacity-50"
                        onClick={() => onAddVarie(user.id)}
                        disabled={goldBusy}
                        title="Aggiungi Varie"
                      >
                        Varie +
                      </button>
                    )}
                    {canGrantBazaar && (
                      <button
                        className="ml-1 flex h-7 px-2 items-center justify-center rounded-full border border-emerald-500/70 text-emerald-300 text-[11px] font-medium transition hover:bg-emerald-500/20 disabled:opacity-50"
                        onClick={() => setGrantUserId(user.id)}
                        disabled={goldBusy}
                        title="Aggiungi Oggetto Bazaar (gratis)"
                      >
                        Bazaar +
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {list.length ? (
                <ul className="space-y-1 pr-1">
                  {list.map((item, index) => {
                    const isVarie = (item.type || "").toLowerCase() === "varie";
                    const displayName = isVarie ? item.name : item.displayName || item.name;
                    const key = `${item.id}-${isVarie ? "v" : "n"}-${index}`;
                    const canEdit = (itemsDocs?.[item.id]?.item_type || isVarie);
                    return (
                      <li key={key} className="flex items-center justify-between text-sm">
                        <span className="truncate mr-2">
                          {displayName}
                          {isVarie ? " (Varie)" : ""}
                        </span>
                        <div className="flex items-center space-x-2">
                          {canEdit && (
                            <button
                              className={iconEditClass}
                              title="Modifica oggetto"
                              onClick={() => onEditInventoryItem(user.id, item.id, isVarie ? null : item.invIndex)}
                            >
                              <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDeleteInventory && !isVarie && (
                            <button
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-red-500/70 text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                              title="Elimina oggetto"
                              onClick={() => setDeleteTarget({
                                userId: user.id,
                                inventoryItemId: item.id,
                                invIndex: isVarie ? null : item.invIndex,
                                displayName: displayName,
                                isVarie,
                              })}
                            >
                              <FontAwesomeIcon icon="trash" className="w-3 h-3" />
                            </button>
                          )}
                          {canDeleteInventory && isVarie && (
                            <button
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-red-500/70 text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                              title="Rimuovi unità Varie"
                              onClick={() => setDeleteVarieTarget({
                                userId: user.id,
                                varieItemId: item.id,
                                displayName: displayName,
                                qty: item.qty || 1,
                              })}
                            >
                              <FontAwesomeIcon icon="trash" className="w-3 h-3" />
                            </button>
                          )}
                          {isVarie && <span className="text-amber-300 text-xs">x{item.qty}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <span className="text-gray-400 italic text-sm">Inventario vuoto</span>
              )}
            </td>
          );
        })}
      </tr>
      {deleteTarget && (
        <DelInventoryItemOverlay
          userId={deleteTarget.userId}
          inventoryItemId={deleteTarget.inventoryItemId}
          userInventoryIndex={deleteTarget.invIndex}
          displayName={deleteTarget.displayName}
          onClose={(ok) => {
            setDeleteTarget(null);
          }}
        />
      )}
      {deleteVarieTarget && (
        <DelVarieItemUnitsOverlay
          userId={deleteVarieTarget.userId}
          varieItemId={deleteVarieTarget.varieItemId}
          displayName={deleteVarieTarget.displayName}
          totalQty={deleteVarieTarget.qty}
          onClose={(ok) => {
            setDeleteVarieTarget(null);
          }}
        />
      )}
      {grantUserId && (
        <AddBazaarItemOverlay
          userId={grantUserId}
          itemsDocs={itemsDocs}
          onClose={(ok) => {
            setGrantUserId(null);
          }}
        />
      )}
    </>
  );
};

export default PlayerInfoInventoryRow;
