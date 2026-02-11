"""
One-off backfill script for `echi_npcs.nome`.

Default mode is dry-run:
  python backfill_npc_nome.py

Apply writes:
  python backfill_npc_nome.py --apply
"""

from __future__ import annotations

import argparse
from typing import Dict, Tuple

from firebase_conn import db


def derive_nome(data: Dict, doc_id: str) -> Tuple[str, bool]:
    current_nome = data.get("nome")
    if isinstance(current_nome, str) and current_nome.strip():
        return current_nome.strip(), False

    description = data.get("description")
    if isinstance(description, str):
        for line in description.splitlines():
            candidate = line.strip()
            if candidate:
                return candidate[:80], True

    return f"NPC-{doc_id[:6]}", True


def run_backfill(apply_changes: bool) -> None:
    docs = list(db.collection("echi_npcs").stream())
    total_docs = len(docs)
    updates = []

    for snap in docs:
        data = snap.to_dict() or {}
        nome, needs_update = derive_nome(data, snap.id)
        if needs_update:
            updates.append((snap.id, nome))

    print(f"Found {total_docs} NPC docs")
    print(f"Docs needing nome backfill: {len(updates)}")

    if not updates:
        print("No updates required.")
        return

    preview_count = min(20, len(updates))
    print(f"Preview first {preview_count} updates:")
    for doc_id, nome in updates[:preview_count]:
        print(f" - {doc_id}: {nome}")

    if not apply_changes:
        print("Dry-run only. Re-run with --apply to write changes.")
        return

    batch_size = 400
    written = 0
    batch = db.batch()
    pending = 0

    for doc_id, nome in updates:
        ref = db.collection("echi_npcs").document(doc_id)
        batch.update(ref, {"nome": nome})
        pending += 1

        if pending >= batch_size:
            batch.commit()
            written += pending
            print(f"Committed {written}/{len(updates)} updates")
            batch = db.batch()
            pending = 0

    if pending:
        batch.commit()
        written += pending
        print(f"Committed {written}/{len(updates)} updates")

    print("Backfill completed successfully.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill echi_npcs.nome field")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply updates to Firestore (default is dry-run)",
    )
    args = parser.parse_args()
    run_backfill(apply_changes=args.apply)


if __name__ == "__main__":
    main()
