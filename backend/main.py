# file: ./backend/main.py
from firebase_conn import db
from fast_api import app
import uvicorn

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
def crea_params():
    # selected_document = db.collection('users').document('DOwwzU7WDwSk84LA4gzOu4YskNI3').get()
    # if selected_document.exists:
    #     print("Document data:", selected_document.to_dict())
    #     doc_data = selected_document.to_dict()
    # else:
    #     print("No such document!")

    # Read all document IDs
    selected_collection = db.collection('users').stream()
    uids = {doc.id for doc in selected_collection}

    print("Characters in Database:", uids)

    # Add "Parametri Base" field to each user
    for uid in uids:
        user_ref = db.collection('users').document(uid)
        user_ref.update({
            "Parametri": {
                "Base": {
                    "Forza": {'Base': 0, 'Anima': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Destrezza": {'Base': 0, 'Anima': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Costituzione": {'Base': 0, 'Anima': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Saggezza": {'Base': 0, 'Anima': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Intelligenza": {'Base': 0, 'Anima': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Fortuna": {'Base': 0, 'Anima': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    },
                "Combattimento": {
                    "Salute": {'Base': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Mira": {'Base': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Attacco": {'Base': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Critico": {'Base': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Difesa": {'Base': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "RiduzioneDanni": {'Base': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    "Disciplina": {'Base': 0, 'Equip': 0, 'Mod': 0, 'Tot': 0},
                    },
                }
        })
        print(f"Updated user {uid} with Parametri Base")


@app.get("/test-endpoint")
def test_endpoint():
    crea_params()
    return {"message": "API Call Successful! Pippo"}

# Run Uvicorn server only if the script is executed directly
if __name__ == "__main__":
    print("Starting FastAPI server...")
    test_endpoint()  # Test the Firebase connection
    print("Firebase Connection Successful!")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
