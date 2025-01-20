# uvicorn main:app --reload --host 127.0.0.1 --port 8000
# uvicorn main:app --reload

import os
import json
from fastapi import FastAPI
import firebase_admin
from firebase_admin import credentials, firestore

app = FastAPI()

# The path to your secret file:
service_account_path = "/etc/secrets/firestoreServiceAccountKey.json"

# Open the file and parse its JSON content:
with open(service_account_path, "r") as f:
    service_account_info = json.load(f)
print("FIREBASE_SERVICE_ACCOUNT:" + str(service_account_info))
# cred = credentials.Certificate("firestoreServiceAccountKey.json")
cred = credentials.Certificate(service_account_info)
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
