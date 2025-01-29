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
        # Read all document IDs
        characters_ref = db.collection('characters').stream()
        characters = {doc.id for doc in characters_ref}
        print("Characters in Database:", characters)

        # Add a test character
        test_character = {"name": "Test Character", "class": "Wizard", "level": 1}
        doc_ref = db.collection('characters').document()
        doc_ref.set(test_character)
        print(f"Added Test Character with ID: {doc_ref.id}")

    except Exception as e:
        print("Error connecting to Firebase:", e)

@app.get("/test-endpoint")
def test_endpoint():
    # return {"message": "API Call Successful! Pippo"}
    return {"message": "API Call Successful! Pippo"}

# Run Uvicorn server only if the script is executed directly
if __name__ == "__main__":
    print("Starting FastAPI server...")
    test_firebase()  # Test the Firebase connection

    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
