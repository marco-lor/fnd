# file: ./backend/main.py
# C:\ProgramData\miniconda3\envs\fatins\Scripts\uvicorn.exe main:app --reload --host 127.0.0.1 --port 8000
from firebase_conn import db
from fast_api import app
import uvicorn
import json
from google.cloud.firestore_v1.types.document import Document     # still useful elsewhere
from google.api_core.datetime_helpers import DatetimeWithNanoseconds

# ---------------------------------------------------------------------------
#  Firestore JSON encoder (unchanged)
# ---------------------------------------------------------------------------
class FirestoreEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, DatetimeWithNanoseconds):
            return obj.isoformat()
        return super().default(obj)

# ---------------------------------------------------------------------------
#  Basic demo / character-related endpoints (unchanged)
# ---------------------------------------------------------------------------
@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI - DnD Game Backend!"}


@app.get("/characters")
def get_characters():
    """Retrieve all character document IDs from the 'characters' collection."""
    characters_ref = db.collection('characters').stream()
    characters = {doc.id for doc in characters_ref}
    print("Retrieved Characters:", characters)
    return {"characters": characters}


@app.post("/characters")
def add_character(character: dict):
    """Add a new character document to the 'characters' collection."""
    doc_ref = db.collection('characters').document()
    doc_ref.set(character)
    print(f"Character added with ID: {doc_ref.id}")
    return {"status": "success", "id": doc_ref.id}

# ---------------------------------------------------------------------------
#  Internal helper utilities (unchanged – for manual / ad-hoc ops)
# ---------------------------------------------------------------------------
def run_call(user_id: str = None, path: str = None):
    """
    Retrieve, modify and update a document at the specified Firestore path.
    (Details omitted – unchanged helper kept for convenience.)
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


def run_call_on_everyone():
    """
    Update all users in 'users' collection using run_call() helper.
    """
    try:
        users_ref = db.collection('users').stream()
        results, user_count = {}, 0
        print("\nProcessing all users in the 'users' collection:")
        print("-----------------------------------")
        for user_doc in users_ref:
            user_id = user_doc.id
            print(f"Processing user: {user_id}")
            user_data = run_call(user_id=user_id)
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


def everything_to_json():
    """
    Dump (most of) Firestore to JSON and save a timestamped backup in ./backend.
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

        from datetime import datetime
        import os
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"firestore_backup_{timestamp}.json"
        filepath = os.path.join(os.path.dirname(__file__), filename)
        with open(filepath, "w", encoding="utf-8") as fp:
            fp.write(formatted_json)
        print(f"Data saved to file: {filepath}")
        print("-----------------------------------")
        return result
    except Exception as e:
        print(f"Error retrieving Firestore data: {str(e)}")
        return {"error": str(e)}

# ---------------------------------------------------------------------------
#  🔄 NEW “schema_armatura” copy logic
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
        "Utilizzi": ["Ingestione", "Copertura Armi", "Accensione e Detonazione", "Contatto su Pelle"], # anche più di uno
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
                                              "Freddo", "Fulmine", "Veleno"], # anche più di uno
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
#  ✅ Endpoint wired to the SAME path used previously by the Codex copier
# ---------------------------------------------------------------------------
# @app.get("/test-endpoint")
def copy_schema_armatura_endpoint():
    """
    Front-end button hits /test-endpoint.
    It now copies SCHEMA_ARMATURA_DATA into 'utils/schema_armatura'.
    """
    return copy_schema_armatura()

# @app.get("/test-endpoint")
def copy_schema_weapon_endpoint():
    """
    Front-end button hits /test-endpoint.
    It now copies SCHEMA_WEAPON_DATA into 'utils/schema_weapon'.
    """
    return copy_schema_weapon()

# @app.get("/test-endpoint")
def copy_schema_accessorio_endpoint():
    """
    Front-end button hits /test-endpoint.
    It now copies SCHEMA_ACCESSORIO_DATA into 'utils/schema_accessorio'.
    """
    return copy_schema_accessorio()

@app.get("/test-endpoint")
def copy_schema_consumabile_endpoint():
    """
    Front-end button hits /test-endpoint.
    It now copies SCHEMA_CONSUMABILI_DATA into 'utils/schema_consumabili'.
    """
    return copy_schema_consumabili()

# ---------------------------------------------------------------------------
#  Bulk operations – existing public endpoints (unchanged)
# ---------------------------------------------------------------------------
@app.get("/update-all-users")
def update_all_users():
    result = run_call_on_everyone()
    user_count = len(result) if isinstance(result, dict) and "error" not in result else 0
    return {"message": f"Updated {user_count} users in the database", "data": result}


@app.get("/all-data")
def get_all_data():
    result = everything_to_json()
    return {"message": "All Firestore data retrieved", "data": result}

# ---------------------------------------------------------------------------
#  Uvicorn bootstrap (unchanged)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("Starting FastAPI server...")
    run_call_on_everyone()  # optional: comment out if not needed on each start
    print("Firebase Connection Successful!")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
