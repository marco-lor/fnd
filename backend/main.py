# file: ./backend/main.py
# C:\ProgramData\miniconda3\envs\fatins\Scripts\uvicorn.exe main:app --reload --host 127.0.0.1 --port 8000
from firebase_conn import db
from fast_api import app
import uvicorn
import json
from google.cloud.firestore_v1.types.document import Document
from google.api_core.datetime_helpers import DatetimeWithNanoseconds

# Classe personalizzata per la serializzazione JSON degli oggetti Firebase
class FirestoreEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, DatetimeWithNanoseconds):
            return obj.isoformat()  # Converte il timestamp in una stringa ISO
        return super().default(obj)

@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI - DnD Game Backend!"}

@app.get("/characters")
def get_characters():
    """
    Retrieve all character document IDs from the 'characters' collection.
    """
    characters_ref = db.collection('characters').stream()
    characters = {doc.id for doc in characters_ref}
    print("Retrieved Characters:", characters)  # Print for debugging in interactive mode
    return {"characters": characters}

@app.post("/characters")
def add_character(character: dict):
    """
    Add a new character document to the 'characters' collection.
    """
    doc_ref = db.collection('characters').document()
    doc_ref.set(character)
    print(f"Character added with ID: {doc_ref.id}")  # Print for debugging
    return {"status": "success", "id": doc_ref.id}

# Optional: Interactive Firebase Testing
def run_call(user_id: str = None, path: str = None):
    """
    Retrieve, modify and update a document at the specified Firestore path.
    
    Args:
        user_id (str, optional): The user ID to process. Takes precedence over path.
        path (str, optional): The path to the Firestore document.
    """
    try:
        # Determine the document path
        if user_id:
            doc_path = f'users/{user_id}'
        elif path:
            doc_path = path
        else:
            doc_path = 'users/TQAmmVfIpOeNiRflXKSeL1NX2ak2'  # Default user as fallback
        
        # Get the specific document
        doc_ref = db.document(doc_path)
        doc = doc_ref.get()
        
        if not doc.exists:
            print(f"Document at {doc_path} not found")
            return None
        
        # Get the document data
        doc_data = doc.to_dict()
        
        # Trasforma la struttura del campo "stats" se presente
        if "stats" in doc_data:
            old_stats = doc_data["stats"]
            new_stats = {
                # Mantieni i campi esistenti che non devono cambiare
                "level": old_stats.get("level", 1),
                "hpTotal": old_stats.get("hpTotal", 0),
                "hpCurrent": old_stats.get("hpCurrent", 0),
                "manaTotal": old_stats.get("manaTotal", 0),
                "manaCurrent": old_stats.get("manaCurrent", 0),
                
                # Nuovi campi di basePoints che sostituiscono ability_points
                "basePointsAvailable": 4,
                "basePointsSpent": 0,
                
                # Nuovi campi di combatTokens che sostituiscono token
                "combatTokensAvailable": 50,
                "combatTokensSpent": 0,
            }
            doc_data["stats"] = new_stats
            
            # Salva il documento modificato in Firestore
            doc_ref.set(doc_data)
            print(f"Document updated in Firestore: {doc_path}")
        
        # Print the document structure in a formatted way
        print(f"\nStructure of document at {doc_path}:")
        print("-----------------------------------")
        formatted_json = json.dumps(doc_data, indent=2, cls=FirestoreEncoder)  # Utilizzo dell'encoder personalizzato
        print(formatted_json)
        print("-----------------------------------")
        
        return doc_data
    except Exception as e:
        print(f"Error retrieving or updating document: {str(e)}")
        return None

def run_call_on_everyone():
    """
    Retrieve all users from the 'users' collection and apply the run_call function to each of them.
    
    Returns:
        dict: A dictionary with user IDs as keys and their updated data as values
    """
    try:
        # Get all user documents from the users collection
        users_ref = db.collection('users').stream()
        
        results = {}
        user_count = 0
        
        print("\nProcessing all users in the 'users' collection:")
        print("-----------------------------------")
        
        # Apply run_call to each user
        for user_doc in users_ref:
            user_id = user_doc.id
            print(f"Processing user: {user_id}")
            
            # Call run_call for this specific user
            user_data = run_call(user_id=user_id)
            
            # Store the result
            if user_data:
                results[user_id] = user_data
                user_count += 1
        
        print(f"-----------------------------------")
        print(f"Total users processed: {user_count}")
        print(f"-----------------------------------")
        
        return results
    except Exception as e:
        print(f"Error processing users: {str(e)}")
        return {"error": str(e)}

def everything_to_json():
    """
    Retrieve all collections and all documents from Firestore, but for the 'users' collection
    only include the document with ID 'TQAmmVfIpOeNiRflXKSeL1NX2ak2'.
    Also saves the data to a JSON file in the backend directory.
    
    Returns:
        dict: A dictionary containing all Firestore data organized by collections
    """
    try:
        result = {}
        
        # Get all collections
        collections = db.collections()
        
        print("\nRetrieving all Firestore data:")
        print("-----------------------------------")
        
        # For each collection
        for collection in collections:
            collection_name = collection.id
            result[collection_name] = {}
            
            if collection_name == "users":
                # For the users collection, only get the specific user
                specific_doc_id = "TQAmmVfIpOeNiRflXKSeL1NX2ak2"
                doc = collection.document(specific_doc_id).get()
                if doc.exists:
                    doc_data = doc.to_dict()
                    result[collection_name][specific_doc_id] = doc_data
            else:
                # For all other collections, get all documents
                docs = collection.stream()
                for doc in docs:
                    doc_id = doc.id
                    doc_data = doc.to_dict()
                    result[collection_name][doc_id] = doc_data
        
        # Format and print the full database structure
        formatted_json = json.dumps(result, indent=2, cls=FirestoreEncoder)
        print(formatted_json)
        print("-----------------------------------")
        
        # Save the data to a JSON file with timestamp
        from datetime import datetime
        import os
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"firestore_backup_{timestamp}.json"
        filepath = os.path.join(os.path.dirname(__file__), filename)
        
        with open(filepath, 'w', encoding='utf-8') as json_file:
            json_file.write(formatted_json)
        
        print(f"Data saved to file: {filepath}")
        print("-----------------------------------")
        
        return result
    except Exception as e:
        print(f"Error retrieving Firestore data: {str(e)}")
        return {"error": str(e)}

# @app.get("/test-endpoint")
def test_endpoint(path: str = None, user_id: str = None):
    if user_id:
        result = run_call(user_id=user_id)
        return {"message": f"API Call Successful! Document for user {user_id} retrieved, modified and updated in Firestore.", "data": result}
    elif path:
        result = run_call(path=path)
        return {"message": "API Call Successful! Document retrieved, modified and updated in Firestore.", "data": result}
    else:
        result = run_call()
        return {"message": "API Call Successful! Default document retrieved, modified and updated in Firestore.", "data": result}

@app.get("/update-all-users")
def update_all_users():
    """
    Endpoint to update all users in the database.
    """
    result = run_call_on_everyone()
    user_count = len(result) if isinstance(result, dict) and "error" not in result else 0
    return {"message": f"Updated {user_count} users in the database", "data": result}

@app.get("/all-data")
def get_all_data():
    """
    Endpoint to retrieve all data from all collections in Firestore.
    """
    result = everything_to_json()
    return {"message": "All Firestore data retrieved", "data": result}

def copy_fields_to_codex():
    """
    Copia i campi 'lingue', 'professioni', 'conoscenze' dal documento 'utils/possible_lists'
    al documento 'utils/codex' nel database Firestore.
    
    Returns:
        dict: Un dizionario che indica il successo o il fallimento dell'operazione
    """
    try:
        # Riferimento al documento sorgente
        possible_lists_ref = db.document('utils/possible_lists')
        source_doc = possible_lists_ref.get()
        
        if not source_doc.exists:
            return {"status": "error", "message": "Documento sorgente 'utils/possible_lists' non trovato"}
        
        # Ottiene i dati sorgente
        source_data = source_doc.to_dict()
        
        # Estrae i campi richiesti
        fields_to_copy = {}
        for field in ['lingue', 'professioni', 'conoscenze']:
            if field in source_data:
                fields_to_copy[field] = source_data[field]
            else:
                print(f"Attenzione: Campo '{field}' non trovato nel documento sorgente")
        
        # Riferimento al documento di destinazione
        codex_ref = db.document('utils/codex')
        target_doc = codex_ref.get()
        
        if target_doc.exists:
            # Aggiorna il documento esistente
            codex_ref.update(fields_to_copy)
        else:
            # Crea un nuovo documento
            codex_ref.set(fields_to_copy)
        
        return {
            "status": "success", 
            "message": "Campi copiati con successo in 'utils/codex'",
            "copied_fields": list(fields_to_copy.keys())
        }
    except Exception as e:
        print(f"Errore durante la copia dei campi nel codex: {str(e)}")
        return {"status": "error", "message": str(e)}

@app.get("/test-endpoint")
def copy_to_codex_endpoint():
    """
    Endpoint per copiare i campi 'lingue', 'professioni', 'conoscenze'
    da 'utils/possible_lists' a 'utils/codex'.
    """
    result = copy_fields_to_codex()
    return result

# Run Uvicorn server only if the script is executed directly
if __name__ == "__main__":
    print("Starting FastAPI server...")
    # Ora è possibile scegliere se testare un singolo utente o tutti gli utenti
    # test_endpoint()  # Test con utente predefinito
    run_call_on_everyone()  # Test su tutti gli utenti
    print("Firebase Connection Successful!")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
