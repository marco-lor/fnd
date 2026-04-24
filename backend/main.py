# file: ./backend/main.py
# C:\ProgramData\miniconda3\envs\fatins\Scripts\uvicorn.exe main:app --reload --host 127.0.0.1 --port 8000
from firebase_conn import db
from fast_api import app
import argparse
import uvicorn
import json
import os
from datetime import datetime
from google.api_core.datetime_helpers import DatetimeWithNanoseconds

# ---------------------------------------------------------------------------
#  Firestore JSON encoder (unchanged)
# ---------------------------------------------------------------------------
class FirestoreEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, DatetimeWithNanoseconds):
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
#  Public healthcheck route
# ---------------------------------------------------------------------------
@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI - DnD Game Backend!"}


# ---------------------------------------------------------------------------
#  Local-only Firestore maintenance helpers
# ---------------------------------------------------------------------------
def run_call(user_id: str = None, path: str = None, dry_run: bool = True):
    """
    Retrieve, modify and update a document at the specified Firestore path.
    Used by local CLI maintenance commands; mutating operations default to dry-run.
    """
    try:
        if user_id:
            doc_path = f'users/{user_id}'
        elif path:
            doc_path = path
        else:
            doc_path = 'users/TQAmmVfIpOeNiRflXKSeL1NX2ak2'

        doc_ref = db.document(doc_path)
        doc = doc_ref.get()
        if not doc.exists:
            print(f"Document at {doc_path} not found")
            return None

        doc_data = doc.to_dict()

        if "stats" in doc_data:
            old_stats = doc_data["stats"]
            new_stats = {
                "level":            old_stats.get("level", 1),
                "hpTotal":          old_stats.get("hpTotal", 0),
                "hpCurrent":        old_stats.get("hpCurrent", 0),
                "manaTotal":        old_stats.get("manaTotal", 0),
                "manaCurrent":      old_stats.get("manaCurrent", 0),
                "basePointsAvailable":   4,
                "basePointsSpent":       0,
                "combatTokensAvailable": 50,
                "combatTokensSpent":     0,
            }
            doc_data["stats"] = new_stats
            if dry_run:
                print(f"[DRY RUN] Would update Firestore document: {doc_path}")
            else:
                doc_ref.set(doc_data)
                print(f"Document updated in Firestore: {doc_path}")

        print(f"\nStructure of document at {doc_path}:")
        print("-----------------------------------")
        formatted_json = json.dumps(doc_data, indent=2, cls=FirestoreEncoder)
        print(formatted_json)
        print("-----------------------------------")
        return doc_data
    except Exception as e:
        print(f"Error retrieving or updating document: {str(e)}")
        return None


def run_call_on_everyone(dry_run: bool = True):
    """
    Normalize all users in the 'users' collection. Defaults to dry-run.
    """
    try:
        users_ref = db.collection('users').stream()
        results, user_count = {}, 0
        print("\nProcessing all users in the 'users' collection:")
        print("-----------------------------------")
        for user_doc in users_ref:
            user_id = user_doc.id
            print(f"Processing user: {user_id}")
            user_data = run_call(user_id=user_id, dry_run=dry_run)
            if user_data:
                results[user_id] = user_data
                user_count += 1
        print("-----------------------------------")
        print(f"Total users processed: {user_count}")
        print("-----------------------------------")
        return results
    except Exception as e:
        print(f"Error processing users: {str(e)}")
        return {"error": str(e)}


def normalize_user_roles(dry_run: bool = True):
    """
    Normalize stored user roles to the canonical contract. Defaults to dry-run.
    """
    try:
        users_ref = db.collection('users').stream()
        summary = {
            "checked": 0,
            "updated": 0,
            "alreadyCanonical": 0,
            "invalid": 0,
        }

        print("\nChecking user role values:")
        print("-----------------------------------")
        for user_doc in users_ref:
            summary["checked"] += 1
            raw_role = user_doc.get("role")
            normalized_role = normalize_role(raw_role)

            if not normalized_role:
                summary["invalid"] += 1
                print(f"Skipping user {user_doc.id}: unsupported role {raw_role!r}")
                continue

            if raw_role == normalized_role:
                summary["alreadyCanonical"] += 1
                continue

            action = "Would normalize" if dry_run else "Normalizing"
            print(
                f"{action} role for {user_doc.id}: {raw_role!r} -> {normalized_role!r}"
            )
            if not dry_run:
                user_doc.reference.update({"role": normalized_role})
            summary["updated"] += 1

        print("-----------------------------------")
        print(
            "Checked {checked} users: {updated} updates, {alreadyCanonical} already canonical, {invalid} invalid.".format(
                **summary
            )
        )
        print("-----------------------------------")
        return summary
    except Exception as e:
        print(f"Error normalizing user roles: {str(e)}")
        return {"error": str(e)}


def everything_to_json(output_dir: str | None = None):
    """
    Dump Firestore to JSON and optionally save a timestamped local backup.
    """
    try:
        result = {}
        collections = db.collections()
        print("\nRetrieving all Firestore data:")
        print("-----------------------------------")

        for collection in collections:
            col_name = collection.id
            result[col_name] = {}
            if col_name == "users":
                specific_doc_id = "TQAmmVfIpOeNiRflXKSeL1NX2ak2"
                doc = collection.document(specific_doc_id).get()
                if doc.exists:
                    result[col_name][specific_doc_id] = doc.to_dict()
            else:
                for doc in collection.stream():
                    result[col_name][doc.id] = doc.to_dict()

        formatted_json = json.dumps(result, indent=2, cls=FirestoreEncoder)
        print(formatted_json)
        print("-----------------------------------")

        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"firestore_backup_{timestamp}.json"
            filepath = os.path.join(output_dir, filename)
            with open(filepath, "w", encoding="utf-8") as fp:
                fp.write(formatted_json)
            print(f"Data saved to file: {filepath}")
        else:
            print("No output file written. Pass --output-dir when using the local CLI export command.")
        print("-----------------------------------")
        return result
    except Exception as e:
        print(f"Error retrieving Firestore data: {str(e)}")
        return {"error": str(e)}

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

def copy_schema_armatura() -> dict:
    """
    Write the SCHEMA_ARMATURA_DATA to the document 'utils/schema_armatura'.
    Returns a status dictionary.
    """
    try:
        doc_ref = db.document("utils/schema_armatura")
        doc_ref.set(SCHEMA_ARMATURA_DATA)   # full overwrite
        return {
            "status":  "success",
            "message": "schema_armatura copied to Firestore at utils/schema_armatura",
        }
    except Exception as exc:
        print(f"Errore durante la copia di schema_armatura: {exc}")
        return {"status": "error", "message": str(exc)}

def copy_schema_weapon() -> dict:
    """
    Write the SCHEMA_WEAPON_DATA to the document 'utils/schema_weapon'.
    Returns a status dictionary.
    """
    try:
        doc_ref = db.document("utils/schema_weapon")
        doc_ref.set(SCHEMA_WEAPON_DATA)   # full overwrite
        return {
            "status":  "success",
            "message": "schema_weapon copied to Firestore at utils/schema_weapon",
        }
    except Exception as exc:
        print(f"Errore durante la copia di schema_weapon: {exc}")
        return {"status": "error", "message": str(exc)}

def copy_schema_accessorio() -> dict:
    """
    Write the SCHEMA_ACCESSORIO_DATA to the document 'utils/schema_accessorio'.
    Returns a status dictionary.
    """
    try:
        doc_ref = db.document("utils/schema_accessorio")
        doc_ref.set(SCHEMA_ACCESSORIO_DATA)   # full overwrite
        return {
            "status":  "success",
            "message": "schema_accessorio copied to Firestore at utils/schema_accessorio",
        }
    except Exception as exc:
        print(f"Errore durante la copia di schema_accessorio: {exc}")
        return {"status": "error", "message": str(exc)}

def copy_schema_consumabili() -> dict:
    """
    Write the SCHEMA_CONSUMABILI_DATA to the document 'utils/schema_consumabili'.
    Returns a status dictionary.
    """
    try:
        doc_ref = db.document("utils/schema_consumabili")
        doc_ref.set(SCHEMA_CONSUMABILI_DATA)   # full overwrite
        return {
            "status":  "success",
            "message": "schema_consumabili copied to Firestore at utils/schema_consumabili",
        }
    except Exception as exc:
        print(f"Errore durante la copia di schema_consumabili: {exc}")
        return {"status": "error", "message": str(exc)}

# ---------------------------------------------------------------------------
#  Local-only CLI command registry
# ---------------------------------------------------------------------------
SCHEMA_COPY_COMMANDS = {
    "armatura": copy_schema_armatura,
    "weapon": copy_schema_weapon,
    "accessorio": copy_schema_accessorio,
    "consumabili": copy_schema_consumabili,
}


def run_admin_cli():
    parser = argparse.ArgumentParser(
        description="Local-only Firestore maintenance tools. No admin operation is exposed as a production HTTP route."
    )
    parser.add_argument("--serve-local", action="store_true", help="Run the healthcheck-only FastAPI app on 127.0.0.1:8000.")
    parser.add_argument("--update-all-users", action="store_true", help="Normalize user stats. Dry-run unless --execute is set.")
    parser.add_argument("--normalize-user-roles", action="store_true", help="Normalize stored user roles. Dry-run unless --execute is set.")
    parser.add_argument("--export-data", action="store_true", help="Export Firestore data to a local ignored backup file.")
    parser.add_argument("--seed-schema", choices=sorted(SCHEMA_COPY_COMMANDS), help="Seed one schema document. Dry-run unless --execute is set.")
    parser.add_argument("--execute", action="store_true", help="Actually perform the selected mutating operation.")
    parser.add_argument("--output-dir", default=os.path.dirname(__file__), help="Output directory for --export-data backups.")
    args = parser.parse_args()

    if args.serve_local:
        print("Starting healthcheck-only FastAPI app on 127.0.0.1:8000...")
        uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
        return

    if args.update_all_users:
        result = run_call_on_everyone(dry_run=not args.execute)
        user_count = len(result) if isinstance(result, dict) and "error" not in result else 0
        mode = "Updated" if args.execute else "Dry-run checked"
        print(f"{mode} {user_count} users.")
        return

    if args.normalize_user_roles:
        normalize_user_roles(dry_run=not args.execute)
        return

    if args.export_data:
        everything_to_json(output_dir=args.output_dir)
        return

    if args.seed_schema:
        if not args.execute:
            print(f"[DRY RUN] Would seed utils/schema_{args.seed_schema}. Re-run with --execute to write it.")
            return
        print(SCHEMA_COPY_COMMANDS[args.seed_schema]())
        return

    parser.print_help()


if __name__ == "__main__":
    run_admin_cli()
