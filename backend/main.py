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
def test_firebase():
    """
    Function to interact with Firebase directly in the Python console.
    Run this manually to check database operations.
    """
    print("Testing Firebase Connection...")

    try:
        selected_document = db.collection('users').document('DOwwzU7WDwSk84LA4gzOu4YskNI3').get()
        if selected_document.exists:
            print("Document data:", selected_document.to_dict())
            doc_data = selected_document.to_dict()
        else:
            print("No such document!")

        # Read all document IDs
        selected_collection = db.collection('users').stream()
        uids = {doc.id for doc in selected_collection}

        print("Characters in Database:", uids)

        # Add "Parametri Base" field to each user
        for uid in uids:
            user_ref = db.collection('users').document(uid)
            user_ref.update({
                "ParametriBase": {
                    "Forza": 0,
                    "Destrezza": 0,
                    "Costituzione": 0,
                    "Saggezza": 0,
                    "Intelligenza": 0,
                    "Fortuna": 0
                }
            })
            print(f"Updated user {uid} with Parametri Base")

    except Exception as e:
        print("Error connecting to Firebase:", e)

@app.get("/test-endpoint")
def test_endpoint():
    test_firebase()
    return {"message": "API Call Successful! Pippo"}

# Run Uvicorn server only if the script is executed directly
if __name__ == "__main__":
    print("Starting FastAPI server...")
    test_firebase()  # Test the Firebase connection
    print("Firebase Connection Successful!")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
