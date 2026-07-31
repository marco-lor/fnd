"""Local-only, explicitly fenced Firestore maintenance commands."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime
from typing import Any, Callable, Mapping, Sequence

try:
    from .firebase_conn import get_db
    from .firestore_backup import (
        FirestoreAdminAdapter,
        apply_restore_plan,
        assert_approved_restore_report,
        assert_safe_firestore_target,
        build_restore_plan,
        build_restore_report,
        export_recursive_firestore,
        read_backup,
        write_json_atomic,
    )
except ImportError:
    from firebase_conn import get_db
    from firestore_backup import (
        FirestoreAdminAdapter,
        apply_restore_plan,
        assert_approved_restore_report,
        assert_safe_firestore_target,
        build_restore_plan,
        build_restore_report,
        export_recursive_firestore,
        read_backup,
        write_json_atomic,
    )

# ---------------------------------------------------------------------------
#  Firestore JSON encoder (unchanged)
# ---------------------------------------------------------------------------
class FirestoreEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


CANONICAL_ROLES = {"player", "dm", "webmaster"}
PLAYER_ROLE_ALIASES = {"player", "players"}


def normalize_role(value: object) -> str:
    if not isinstance(value, str):
        return ""

    normalized_role = value.strip().lower()
    if normalized_role in PLAYER_ROLE_ALIASES:
        return "player"
    if normalized_role in CANONICAL_ROLES:
        return normalized_role
    return ""

# ---------------------------------------------------------------------------
#  Local-only Firestore maintenance helpers
# ---------------------------------------------------------------------------
def _opaque_id(value: object) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:12]


def _redacted_error(exc: Exception) -> dict[str, str]:
    return {
        "errorClass": type(exc).__name__,
        "errorHash": _opaque_id(str(exc)),
    }


def _legacy_stats_plan(doc_data: Mapping[str, Any]) -> tuple[dict[str, Any], bool]:
    planned = dict(doc_data)
    old_stats = doc_data.get("stats")
    if not isinstance(old_stats, Mapping):
        return planned, False
    new_stats = {
        "level": old_stats.get("level", 1),
        "hpTotal": old_stats.get("hpTotal", 0),
        "hpCurrent": old_stats.get("hpCurrent", 0),
        "manaTotal": old_stats.get("manaTotal", 0),
        "manaCurrent": old_stats.get("manaCurrent", 0),
        "basePointsAvailable": 4,
        "basePointsSpent": 0,
        "combatTokensAvailable": 50,
        "combatTokensSpent": 0,
    }
    planned["stats"] = new_stats
    return planned, old_stats != new_stats


def run_call(
    user_id: str | None = None,
    path: str | None = None,
    dry_run: bool = True,
    *,
    database: Any,
):
    """
    Retrieve, modify and update a document at the specified Firestore path.
    Used by local CLI maintenance commands; mutating operations default to dry-run.
    """
    if not dry_run:
        raise RuntimeError(
            "Legacy root-stat normalization writes are retired by Task 05. "
            "Use the fenced user-data V2 migration workflow instead."
        )

    try:
        if user_id:
            doc_path = f'users/{user_id}'
        elif path:
            doc_path = path
        else:
            doc_path = 'users/TQAmmVfIpOeNiRflXKSeL1NX2ak2'

        doc_ref = database.document(doc_path)
        doc = doc_ref.get()
        if not doc.exists:
            result = {
                "status": "not-found",
                "documentHash": _opaque_id(doc_path),
                "wouldChange": False,
            }
            print(json.dumps(result, sort_keys=True))
            return result

        _, would_change = _legacy_stats_plan(doc.to_dict() or {})
        result = {
            "status": "dry-run",
            "documentHash": _opaque_id(doc_path),
            "wouldChange": would_change,
        }
        print(json.dumps(result, sort_keys=True))
        return result
    except Exception as e:
        result = {"status": "error", **_redacted_error(e)}
        print(json.dumps(result, sort_keys=True))
        return result


def run_call_on_everyone(*, database: Any, dry_run: bool = True):
    """
    Normalize all users in the 'users' collection. Defaults to dry-run.
    """
    if not dry_run:
        raise RuntimeError(
            "Legacy root-stat normalization writes are retired by Task 05. "
            "Use the fenced user-data V2 migration workflow instead."
        )

    try:
        summary = {"checked": 0, "wouldChange": 0}
        for user_doc in database.collection("users").stream():
            summary["checked"] += 1
            _, would_change = _legacy_stats_plan(user_doc.to_dict() or {})
            summary["wouldChange"] += int(would_change)
        result = {"status": "dry-run", **summary}
        print(json.dumps(result, sort_keys=True))
        return result
    except Exception as e:
        result = {"status": "error", **_redacted_error(e)}
        print(json.dumps(result, sort_keys=True))
        return result


def normalize_user_roles(*, database: Any, dry_run: bool = True, batch_size: int = 400):
    """
    Normalize stored user roles to the canonical contract. Defaults to dry-run.
    """
    if not 1 <= batch_size <= 400:
        raise ValueError("Role-normalization batch_size must be between 1 and 400.")

    try:
        summary = {
            "checked": 0,
            "updated": 0,
            "alreadyCanonical": 0,
            "invalid": 0,
            "commits": 0,
        }
        batch = None
        pending = 0
        for user_doc in database.collection("users").stream():
            summary["checked"] += 1
            raw_role = user_doc.get("role")
            normalized_role = normalize_role(raw_role)

            if not normalized_role:
                summary["invalid"] += 1
                continue

            if raw_role == normalized_role:
                summary["alreadyCanonical"] += 1
                continue

            if not dry_run:
                if batch is None:
                    batch = database.batch()
                batch.update(user_doc.reference, {"role": normalized_role})
                pending += 1
                if pending == batch_size:
                    batch.commit()
                    summary["commits"] += 1
                    batch = None
                    pending = 0
            summary["updated"] += 1

        if batch is not None and pending:
            batch.commit()
            summary["commits"] += 1

        result = {"status": "dry-run" if dry_run else "complete", **summary}
        print(json.dumps(result, sort_keys=True))
        return result
    except Exception as e:
        result = {"status": "error", **_redacted_error(e)}
        print(json.dumps(result, sort_keys=True))
        return result


def _assert_adapter_project(project_id: str, adapter: FirestoreAdminAdapter) -> None:
    client_project = str(getattr(adapter.client, "project", "") or "")
    if client_project and client_project != project_id:
        raise ValueError(
            "Initialized Firestore client project does not match the explicit project ID."
        )


def everything_to_json(
    output_dir: str | None = None,
    *,
    project_id: str,
    database: Any | None = None,
    adapter: FirestoreAdminAdapter | None = None,
):
    """Create a versioned recursive backup without printing private documents."""
    if adapter is None and database is None:
        raise ValueError("A Firestore database or adapter is required.")
    backup_adapter = adapter or FirestoreAdminAdapter(database)
    _assert_adapter_project(project_id, backup_adapter)
    backup = export_recursive_firestore(backup_adapter, project_id=project_id)
    filepath = None
    if output_dir:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = os.path.join(output_dir, f"firestore_backup_v2_{timestamp}.json")
        write_json_atomic(filepath, backup)

    print(json.dumps({
        "status": "complete",
        "operation": "recursive-export",
        "targetHash": _opaque_id(project_id),
        "canonicalHash": backup["canonicalHash"],
        "counts": backup["counts"],
        "wroteOutput": filepath is not None,
    }, indent=2))
    return backup


def restore_from_json(
    backup_path: str,
    *,
    project_id: str,
    report_path: str,
    execute: bool = False,
    live_target: bool = True,
    approved_fingerprint: str = "",
    database: Any | None = None,
    adapter: FirestoreAdminAdapter | None = None,
):
    """Plan or apply a non-destructive recursive restore; dry-run is the default."""
    if execute and live_target:
        raise ValueError(
            "Live restore execution is blocked until a compatible mutation pause fence exists."
        )
    if adapter is None and database is None:
        raise ValueError("A Firestore database or adapter is required.")
    restore_adapter = adapter or FirestoreAdminAdapter(database)
    _assert_adapter_project(project_id, restore_adapter)
    backup = read_backup(backup_path, expected_project_id=project_id)
    plan = build_restore_plan(restore_adapter, backup, project_id=project_id)

    if not execute:
        report = build_restore_report(plan)
        write_json_atomic(report_path, report)
        print(json.dumps({
            "status": "complete",
            "operation": "restore-dry-run",
            "targetHash": _opaque_id(project_id),
            "backupHash": plan["backupHash"],
            "planFingerprint": plan["planFingerprint"],
            "counts": plan["counts"],
            "wroteReport": True,
        }, indent=2))
        return report

    with open(report_path, "r", encoding="utf-8") as report_file:
        report = json.load(report_file)
    assert_approved_restore_report(
        report,
        plan,
        approved_fingerprint=approved_fingerprint,
    )
    result = apply_restore_plan(
        restore_adapter,
        plan,
        **restore_adapter.restore_factories(),
    )
    print(json.dumps({
        "status": "complete",
        "operation": "restore-execute",
        "targetHash": _opaque_id(project_id),
        "backupHash": plan["backupHash"],
        "planFingerprint": plan["planFingerprint"],
        **result,
    }, indent=2))
    return result

# ---------------------------------------------------------------------------
#  schema_armatura copy logic
# ---------------------------------------------------------------------------

# The JSON that must be written **as the fields** of utils/schema_armatura
SCHEMA_ARMATURA_DATA = {
    "General": {
        "Nome": "Nome Armatura",
        "Slot": [
            "Testa", 
            "Corpo", 
            "Cintura", 
            "Fodero", 
            "Stivali", 
            "Accessorio", 
            "Consumabile", 
            "Consumabile Grande", 
            "-"
        ],
        "Effetto": "Descrizione dell'effetto.",
        "requisiti": "",
        "ridCostoTecSingola": {"nomeTecnica": 0},
        "ridCostoSpellSingola": {"nome_spell": 0},
        "spells": {},
        "prezzo": 0,
        "image_url": ""
    },
    "Specific": {
        "slotCintura": 0
    },
    "Parametri": {
        "Base": {
            "Fortuna":       {"1": 0, "4": 0, "7": 0, "10": 0},
            "Intelligenza":  {"1": 0, "4": 0, "7": 0, "10": 0},
            "Saggezza":      {"1": 0, "4": 0, "7": 0, "10": 0},
            "Forza":         {"1": 0, "4": 0, "7": 0, "10": 0},
            "Destrezza":     {"1": 0, "4": 0, "7": 0, "10": 0},
            "Costituzione":  {"1": 0, "4": 0, "7": 0, "10": 0}
        },
        "Combattimento": {
            "Disciplina":     {"1": 0, "4": 0, "7": 0, "10": 0},
            "Critico":        {"1": 0, "4": 0, "7": 0, "10": 0},
            "RiduzioneDanni": {"1": 0, "4": 0, "7": 0, "10": 0},
            "Difesa":         {"1": 0, "4": 0, "7": 0, "10": 0},
            "Salute":         {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira":           {"1": 0, "4": 0, "7": 0, "10": 0},
            "Attacco":        {"1": 0, "4": 0, "7": 0, "10": 0}
        },
        "Special": {
            "ridCostoTec":                   {"1": 0, "4": 0, "7": 0, "10": 0},
            "ridCostoSpell":                 {"1": 0, "4": 0, "7": 0, "10": 0},
            "Bonus Danno":                   {"1": 0, "4": 0, "7": 0, "10": 0},
            "Bonus Danno Critico":           {"1": 0, "4": 0, "7": 0, "10": 0},
            "Penetrazione":                  {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira 1H":                       {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira 2H":                       {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira Ranged":                   {"1": 0, "4": 0, "7": 0, "10": 0},
            "Riduzione Dado Effetto Critico": {"1": 0, "4": 0, "7": 0, "10": 0},
            "Danno":                         {"1": "", "4": "", "7": "", "10": ""},
            "Danno Critico":                 {"1": "", "4": "", "7": "", "10": ""}
        }
    }
}

SCHEMA_ACCESSORIO_DATA = {
    "General": {
        "Nome": "Nome Armatura",
        "Slot": [
            "Consumabile", 
            "Consumabile Grande", 
            "-"
        ],
        "Effetto": "Descrizione dell'effetto.",
        "requisiti": "",
        "ridCostoTecSingola": {"nomeTecnica": 0},
        "ridCostoSpellSingola": {"nome_spell": 0},
        "spells": {},
        "prezzo": 0,
        "image_url": ""
    },
    "Specific": {
        "slotCinturaOccupati": 0,
        "stackable": True,
        "maxStack": 1,
        "effects": [
            {
              "type": ["one-shot", "temporary", "permanent"],
              "target": ["stats.hpCurrent", "Parametri.Base.Forza.Base", "Parametri.Combattimento.Attacco.Mod"],
              "effect": "+2d8",
              "duration_turns": 0 # only for temporary effects
            }
        ]
    },
    "Parametri": {
        "Base": {
            "Fortuna":       {"1": 0, "4": 0, "7": 0, "10": 0},
            "Intelligenza":  {"1": 0, "4": 0, "7": 0, "10": 0},
            "Saggezza":      {"1": 0, "4": 0, "7": 0, "10": 0},
            "Forza":         {"1": 0, "4": 0, "7": 0, "10": 0},
            "Destrezza":     {"1": 0, "4": 0, "7": 0, "10": 0},
            "Costituzione":  {"1": 0, "4": 0, "7": 0, "10": 0}
        },
        "Combattimento": {
            "Disciplina":     {"1": 0, "4": 0, "7": 0, "10": 0},
            "Critico":        {"1": 0, "4": 0, "7": 0, "10": 0},
            "RiduzioneDanni": {"1": 0, "4": 0, "7": 0, "10": 0},
            "Difesa":         {"1": 0, "4": 0, "7": 0, "10": 0},
            "Salute":         {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira":           {"1": 0, "4": 0, "7": 0, "10": 0},
            "Attacco":        {"1": 0, "4": 0, "7": 0, "10": 0}
        },
        "Special": {
            "ridCostoTec":                   {"1": 0, "4": 0, "7": 0, "10": 0},
            "ridCostoSpell":                 {"1": 0, "4": 0, "7": 0, "10": 0},
            "Bonus Danno":                   {"1": 0, "4": 0, "7": 0, "10": 0},
            "Bonus Danno Critico":           {"1": 0, "4": 0, "7": 0, "10": 0},
            "Penetrazione":                  {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira 1H":                       {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira 2H":                       {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira Ranged":                   {"1": 0, "4": 0, "7": 0, "10": 0},
            "Riduzione Dado Effetto Critico": {"1": 0, "4": 0, "7": 0, "10": 0},
            "Danno":                         {"1": "", "4": "", "7": "", "10": ""},
            "Danno Critico":                 {"1": "", "4": "", "7": "", "10": ""}
        }
    }
}


SCHEMA_WEAPON_DATA = {
    "General": {
      "Nome": "Nome Arma",
      "Slot": ["Mano Principale", "Mano Secondaria"],
      "Effetto": "Descrizione dell'effetto.",
      "requisiti": "",
      "ridCostoTecSingola": {"nomeTecnica": 0},
      "ridCostoSpellSingola": {"nome_spell": 0},
      "spells": {},
      "prezzo": 0,
      "image_url": ""
    },
    "Specific": {
      "Hands": [1, 2],
      "Tipo": ["Mischia", "Distanza"]
    },
    "Parametri": {
      "Base": {
        "Fortuna":      {"1":0,"4":0,"7":0,"10":0},
        "Intelligenza": {"1":0,"4":0,"7":0,"10":0},
        "Saggezza":     {"1":0,"4":0,"7":0,"10":0},
        "Forza":        {"1":0,"4":0,"7":0,"10":0},
        "Destrezza":    {"1":0,"4":0,"7":0,"10":0},
        "Costituzione": {"1":0,"4":0,"7":0,"10":0}
      },
      "Combattimento": {
        "Disciplina":      {"1":0,"4":0,"7":0,"10":0},
        "Critico":         {"1":0,"4":0,"7":0,"10":0},
        "RiduzioneDanni":  {"1":0,"4":0,"7":0,"10":0},
        "Difesa":          {"1":0,"4":0,"7":0,"10":0},
        "Salute":          {"1":0,"4":0,"7":0,"10":0},
        "Mira":            {"1":0,"4":0,"7":0,"10":0},
        "Attacco":         {"1":0,"4":0,"7":0,"10":0}
      },
      "Special": {
        "ridCostoTec":           {"1":0,"4":0,"7":0,"10":0},
        "Bonus Danno":           {"1":0,"4":0,"7":0,"10":0},
        "Penetrazione":          {"1":0,"4":0,"7":0,"10":0},
        "ridCostoSpell":         {"1":0,"4":0,"7":0,"10":0},
        "Danno Critico":         {"1":"1d6","4":"1d6","7":"1d6","10":"1d6"},
        "Danno":                 {"1":"1d4","4":"1d4","7":"1d4","10":"1d4"},
        "Bonus Danno Critico":   {"1":0,"4":0,"7":0,"10":0}
      }
    }
  }
SCHEMA_CONSUMABILI_DATA = {
    "General": {
        "Nome": "Nome Consumabile",
        "Slot": [
            "Consumabile",
            "Consumabile Grande",
            "-"
        ],
        "Effetto": "Descrizione dell'effetto.",
        "requisiti": "",
        "ridCostoTecSingola": {"nomeTecnica": 0},
        "ridCostoSpellSingola": {"nome_spell": 0},
        "spells": {},
        "prezzo": 0,
        "image_url": ""
    },
    "Specific": {
        "slotCinturaOccupati": 0,
        "Utilizzi": ["Ingestione", "Copertura Armi", "Accensione e Detonazione", "Contatto su Pelle"], # anche piu di uno
        "type": ["Uso Singolo", "Effetto Temporaneo", "Effetto Permanente"], # selezione unica
        "duration_turns": 0,  # only for temporary effects
        "stackable": True,
        "maxStack": 2,
        "Bonus Creazione": 0, # generalmente INT + SAG del creatore
        "Parametro Prova Ambientale": "",  # selezione unica
    },
    "Parametri": {
        "Base": {
            "Fortuna":       {"1": 0, "4": 0, "7": 0, "10": 0},
            "Intelligenza":  {"1": 0, "4": 0, "7": 0, "10": 0},
            "Saggezza":      {"1": 0, "4": 0, "7": 0, "10": 0},
            "Forza":         {"1": 0, "4": 0, "7": 0, "10": 0},
            "Destrezza":     {"1": 0, "4": 0, "7": 0, "10": 0},
            "Costituzione":  {"1": 0, "4": 0, "7": 0, "10": 0}
        },
        "Combattimento": {
            "Disciplina":     {"1": 0, "4": 0, "7": 0, "10": 0},
            "Critico":        {"1": 0, "4": 0, "7": 0, "10": 0},
            "RiduzioneDanni": {"1": 0, "4": 0, "7": 0, "10": 0},
            "Difesa":         {"1": 0, "4": 0, "7": 0, "10": 0},
            "Salute":         {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira":           {"1": 0, "4": 0, "7": 0, "10": 0},
            "Attacco":        {"1": 0, "4": 0, "7": 0, "10": 0}
        },
        "Special": {
            "ridCostoTec":                   {"1": 0, "4": 0, "7": 0, "10": 0},
            "ridCostoSpell":                 {"1": 0, "4": 0, "7": 0, "10": 0},
            "Bonus Danno":                   {"1": 0, "4": 0, "7": 0, "10": 0},
            "Bonus Danno Critico":           {"1": 0, "4": 0, "7": 0, "10": 0},
            "Penetrazione":                  {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira 1H":                       {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira 2H":                       {"1": 0, "4": 0, "7": 0, "10": 0},
            "Mira Ranged":                   {"1": 0, "4": 0, "7": 0, "10": 0},
            "Riduzione Dado Effetto Critico": {"1": 0, "4": 0, "7": 0, "10": 0},
            "Danno":                         {"1": "", "4": "", "7": "", "10": ""},
            "Danno Critico":                 {"1": "", "4": "", "7": "", "10": ""},
            "Tipo Danno":                    ["Fisico", "Magico", "Energia", "Acido", "Fuoco",
                                              "Freddo", "Fulmine", "Veleno"], # anche piu di uno
            "Prova Ambientale":              {"1": 0, "4": 0, "7": 0, "10": 0},

            "Rigenera Dado Anima HP":        {"1": 0, "4": 0, "7": 0, "10": 0},
            "Rigenera Dado Anima Mana":      {"1": 0, "4": 0, "7": 0, "10": 0},
        }
    }
}

def copy_schema_armatura(*, database: Any) -> dict:
    """
    Write the SCHEMA_ARMATURA_DATA to the document 'utils/schema_armatura'.
    Returns a status dictionary.
    """
    try:
        doc_ref = database.document("utils/schema_armatura")
        doc_ref.set(SCHEMA_ARMATURA_DATA)   # full overwrite
        return {"status": "success", "schema": "armatura"}
    except Exception as exc:
        return {"status": "error", **_redacted_error(exc)}

def copy_schema_weapon(*, database: Any) -> dict:
    """
    Write the SCHEMA_WEAPON_DATA to the document 'utils/schema_weapon'.
    Returns a status dictionary.
    """
    try:
        doc_ref = database.document("utils/schema_weapon")
        doc_ref.set(SCHEMA_WEAPON_DATA)   # full overwrite
        return {"status": "success", "schema": "weapon"}
    except Exception as exc:
        return {"status": "error", **_redacted_error(exc)}

def copy_schema_accessorio(*, database: Any) -> dict:
    """
    Write the SCHEMA_ACCESSORIO_DATA to the document 'utils/schema_accessorio'.
    Returns a status dictionary.
    """
    try:
        doc_ref = database.document("utils/schema_accessorio")
        doc_ref.set(SCHEMA_ACCESSORIO_DATA)   # full overwrite
        return {"status": "success", "schema": "accessorio"}
    except Exception as exc:
        return {"status": "error", **_redacted_error(exc)}

def copy_schema_consumabili(*, database: Any) -> dict:
    """
    Write the SCHEMA_CONSUMABILI_DATA to the document 'utils/schema_consumabili'.
    Returns a status dictionary.
    """
    try:
        doc_ref = database.document("utils/schema_consumabili")
        doc_ref.set(SCHEMA_CONSUMABILI_DATA)   # full overwrite
        return {"status": "success", "schema": "consumabili"}
    except Exception as exc:
        return {"status": "error", **_redacted_error(exc)}

# ---------------------------------------------------------------------------
#  Local-only CLI command registry
# ---------------------------------------------------------------------------
SCHEMA_COPY_COMMANDS = {
    "armatura": copy_schema_armatura,
    "weapon": copy_schema_weapon,
    "accessorio": copy_schema_accessorio,
    "consumabili": copy_schema_consumabili,
}


def _require_safe_target(
    parser: argparse.ArgumentParser,
    args: argparse.Namespace,
    *,
    operation: str = "",
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    if not args.project:
        parser.error("This Firestore command requires an explicit --project.")
    try:
        return assert_safe_firestore_target(
            project_id=args.project,
            allow_live_project=args.allow_live_project,
            confirm_project=args.confirm_project,
            operation=operation,
            execute=args.execute,
            environment=environment,
        )
    except ValueError as exc:
        parser.error(str(exc))


def run_admin_cli(
    argv: Sequence[str] | None = None,
    *,
    db_factory: Callable[..., Any] = get_db,
    environment: Mapping[str, str] | None = None,
):
    parser = argparse.ArgumentParser(
        description="Local-only Firestore maintenance tools. No admin operation is exposed as a production HTTP route."
    )
    parser.add_argument("--serve-local", action="store_true", help="Run the healthcheck-only FastAPI app on 127.0.0.1:8000.")
    parser.add_argument(
        "--update-all-users",
        action="store_true",
        help="Inspect legacy user-stat normalization as a read-only dry run; write mode is retired by Task 05.",
    )
    parser.add_argument("--normalize-user-roles", action="store_true", help="Normalize stored user roles. Dry-run unless --execute is set.")
    parser.add_argument("--export-data", action="store_true", help="Recursively export Firestore to a versioned ignored backup file.")
    parser.add_argument("--restore-data", metavar="BACKUP", help="Plan a non-destructive recursive restore. Dry-run unless --execute is set.")
    parser.add_argument("--seed-schema", choices=sorted(SCHEMA_COPY_COMMANDS), help="Seed one schema document. Dry-run unless --execute is set.")
    parser.add_argument("--execute", action="store_true", help="Actually perform the selected mutating operation.")
    parser.add_argument("--project", help="Exact Firebase project ID required by every Firestore operation.")
    parser.add_argument("--allow-live-project", action="store_true", help="Acknowledge that the selected maintenance operation may read a live project.")
    parser.add_argument("--confirm-project", default="", help="Repeat the exact project ID before any live Firestore access.")
    parser.add_argument("--approve-fingerprint", default="", help="Exact restore dry-run fingerprint required with --execute.")
    parser.add_argument("--output-dir", default=os.path.join(os.path.dirname(__file__), "backups"), help="Ignored output directory for backups/reports.")
    parser.add_argument("--restore-report", help="Restore dry-run report path; defaults inside --output-dir.")
    args = parser.parse_args(argv)

    if args.serve_local:
        try:
            from .health_app import app
        except ImportError:
            from health_app import app
        import uvicorn

        print("Starting healthcheck-only FastAPI app on 127.0.0.1:8000...")
        uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
        return

    if args.update_all_users:
        if args.execute:
            parser.error(
                "--update-all-users --execute is retired by Task 05; "
                "use the fenced user-data V2 migration workflow instead."
            )
        _require_safe_target(parser, args, environment=environment)
        database = db_factory(project_id=args.project)
        return run_call_on_everyone(database=database, dry_run=True)

    if args.normalize_user_roles:
        _require_safe_target(parser, args, environment=environment)
        database = db_factory(project_id=args.project)
        return normalize_user_roles(
            database=database,
            dry_run=not args.execute,
        )

    if args.export_data:
        _require_safe_target(parser, args, environment=environment)
        database = db_factory(project_id=args.project)
        return everything_to_json(
            output_dir=args.output_dir,
            project_id=args.project,
            database=database,
        )

    if args.restore_data:
        target_safety = _require_safe_target(
            parser,
            args,
            operation="restore",
            environment=environment,
        )
        database = db_factory(project_id=args.project)
        report_path = args.restore_report or os.path.join(
            args.output_dir,
            "firestore_restore_v2_dry_run.json",
        )
        return restore_from_json(
            args.restore_data,
            project_id=args.project,
            report_path=report_path,
            execute=args.execute,
            live_target=target_safety["live"],
            approved_fingerprint=args.approve_fingerprint,
            database=database,
        )

    if args.seed_schema:
        _require_safe_target(parser, args, environment=environment)
        if not args.execute:
            result = {
                "status": "dry-run",
                "operation": "seed-schema",
                "schema": args.seed_schema,
                "targetHash": _opaque_id(args.project),
            }
            print(json.dumps(result, sort_keys=True))
            return result
        database = db_factory(project_id=args.project)
        result = SCHEMA_COPY_COMMANDS[args.seed_schema](database=database)
        print(json.dumps(result, sort_keys=True))
        return result

    parser.print_help()


if __name__ == "__main__":
    run_admin_cli()
