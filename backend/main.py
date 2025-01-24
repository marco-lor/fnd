# uvicorn main:app --reload --host 127.0.0.1 --port 8000
# uvicorn main:app --reload
# file ./backend/main.py

from firebase_conn import db
from fast_api import app


@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI - DnD Game Backend!"}

# @app.get("/characters")
# def get_characters():
#     # Example: read from 'characters' collection
#     characters_ref = db.collection('characters').stream()
#     characters = [doc.to_dict() for doc in characters_ref]  # Convert each document to a dict
#     return {"characters": characters}

# write a get request to get all the document ids inside the collection characters
@app.get("/characters")
def get_characters():
    # Example: read from 'characters' collection
    characters_ref = db.collection('characters').stream()
    # characters = {doc.id: doc.to_dict() for doc in characters_ref}
    characters = {doc.id for doc in characters_ref}
    print(characters)
    return {"characters": characters}

@app.post("/characters")
def add_character(character: dict):
    # Example: add a new document to 'characters'
    doc_ref = db.collection('characters').document()
    doc_ref.set(character)
    return {"status": "success", "id": doc_ref.id}
