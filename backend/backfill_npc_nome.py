"""
One-off backfill script for `echi_npcs.nome`.

Default mode is dry-run:
  python backfill_npc_nome.py

Apply writes:
  python backfill_npc_nome.py --apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
from typing import Any, Dict, Sequence, Tuple

try:
    from .firebase_conn import get_db
    from .firestore_backup import assert_safe_firestore_target
except ImportError:
    from firebase_conn import get_db
    from firestore_backup import assert_safe_firestore_target


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


def _opaque_id(value: object) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:12]


def _document_id_field() -> object:
    try:
        from google.cloud.firestore_v1 import FieldPath
    except ImportError:
        # Unit tests can exercise the paging contract without maintenance deps.
        return "__name__"
    return FieldPath.document_id()


def _ordered_pages(collection: Any, *, page_size: int):
    ordered_query = collection.order_by(_document_id_field())
    cursor = None

    while True:
        query = ordered_query
        if cursor is not None:
            query = query.start_after(cursor)
        page = list(query.limit(page_size).stream())
        if not page:
            return
        yield page
        if len(page) < page_size:
            return
        cursor = page[-1]


def run_backfill(
    *,
    database: Any,
    apply_changes: bool = False,
    batch_size: int = 400,
    page_size: int = 400,
) -> dict[str, Any]:
    if not 1 <= batch_size <= 400:
        raise ValueError("NPC backfill batch_size must be between 1 and 400.")
    if not 1 <= page_size <= 400:
        raise ValueError("NPC backfill page_size must be between 1 and 400.")

    checked = 0
    would_update = 0
    written = 0
    commits = 0
    sample_hashes = []
    batch = None
    pending = 0

    collection = database.collection("echi_npcs")
    for page in _ordered_pages(collection, page_size=page_size):
        for snap in page:
            checked += 1
            data = snap.to_dict() or {}
            nome, needs_update = derive_nome(data, snap.id)
            if not needs_update:
                continue

            would_update += 1
            if len(sample_hashes) < 5:
                sample_hashes.append(_opaque_id(snap.id))
            if not apply_changes:
                continue

            if batch is None:
                batch = database.batch()
            batch.update(snap.reference, {"nome": nome})
            pending += 1

            if pending == batch_size:
                batch.commit()
                written += pending
                commits += 1
                batch = None
                pending = 0

    if batch is not None and pending:
        batch.commit()
        written += pending
        commits += 1

    result = {
        "status": "complete" if apply_changes else "dry-run",
        "checked": checked,
        "wouldUpdate": would_update,
        "written": written,
        "commits": commits,
    }
    if not apply_changes and sample_hashes:
        result["sampleHashes"] = sample_hashes
    print(json.dumps(result, sort_keys=True))
    return result


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Backfill echi_npcs.nome field")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply updates to Firestore (default is dry-run)",
    )
    parser.add_argument("--project", required=True, help="Exact Firebase project ID.")
    parser.add_argument(
        "--allow-live-project",
        action="store_true",
        help="Acknowledge that this command may access a live Firestore project.",
    )
    parser.add_argument(
        "--confirm-project",
        default="",
        help="Repeat the exact project ID before any live Firestore access.",
    )
    args = parser.parse_args(argv)
    try:
        assert_safe_firestore_target(
            project_id=args.project,
            allow_live_project=args.allow_live_project,
            confirm_project=args.confirm_project,
            operation="backfill-npc-nome",
            execute=args.apply,
        )
    except ValueError as exc:
        parser.error(str(exc))

    database = get_db(project_id=args.project)
    run_backfill(database=database, apply_changes=args.apply)


if __name__ == "__main__":
    main()
