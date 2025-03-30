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
def run_call(path: str = 'users/TQAmmVfIpOeNiRflXKSeL1NX2ak2'):
    """
    Retrieve and print the structure of a document at the specified Firestore path.
    
    Args:
        path (str): The path to the Firestore document (e.g., 'users/OgVlbkriGFdtUu1WEkP8OCaXyKL2')
    """
    try:
        # Get the specific document
        doc_ref = db.document(path)
        doc = doc_ref.get()
        
        if not doc.exists:
            print(f"Document at {path} not found")
            return None
        
        # Get the document data
        doc_data = doc.to_dict()
        
        # Print the document structure in a formatted way
        print(f"\nStructure of document at {path}:")
        print("-----------------------------------")
        formatted_json = json.dumps(doc_data, indent=2, cls=FirestoreEncoder)  # Utilizzo dell'encoder personalizzato
        print(formatted_json)
        print("-----------------------------------")
        
        return doc_data
    except Exception as e:
        print(f"Error retrieving document: {str(e)}")
        return None

def everything_to_json():
    """
    Retrieve all collections and all documents from Firestore, but for the 'users' collection
    only include the document with ID 'TQAmmVfIpOeNiRflXKSeL1NX2ak2'.
    
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
        
        return result
    except Exception as e:
        print(f"Error retrieving Firestore data: {str(e)}")
        return {"error": str(e)}

@app.get("/test-endpoint")
def test_endpoint(path: str = None):
    if path:
        result = run_call(path)
    else:
        result = run_call()
    return {"message": "API Call Successful!", "data": result}

@app.get("/all-data")
def get_all_data():
    """
    Endpoint to retrieve all data from all collections in Firestore.
    """
    result = everything_to_json()
    return {"message": "All Firestore data retrieved", "data": result}

# Run Uvicorn server only if the script is executed directly
if __name__ == "__main__":
    print("Starting FastAPI server...")
    test_endpoint()  # Test the Firebase connection
    print("Firebase Connection Successful!")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
