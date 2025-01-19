# uvicorn main:app --reload --host 127.0.0.1 --port 8000
# uvicorn main:app --reload

import os
from fastapi import FastAPI
import firebase_admin
from firebase_admin import credentials, firestore

app = FastAPI()

# Path to the service account file:
cred = credentials.Certificate("firestoreServiceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI - DnD Game Backend!"}

@app.get("/characters")
def get_characters():
    # Example: read from 'characters' collection
    characters_ref = db.collection('characters').stream()
    characters = []
    for doc in characters_ref:
        characters.append(doc.to_dict())  # Convert each document to a dict
    return {"characters": characters}

@app.post("/characters")
def add_character(character: dict):
    # Example: add a new document to 'characters'
    doc_ref = db.collection('characters').document()
    doc_ref.set(character)
    return {"status": "success", "id": doc_ref.id}
