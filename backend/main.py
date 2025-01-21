# uvicorn main:app --reload --host 127.0.0.1 --port 8000
# uvicorn main:app --reload

import os
import json
from fastapi import FastAPI
import firebase_admin
from firebase_admin import credentials, firestore
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

origins = [
    "https://fatins.web.app",  # The Firebase Hosting URL of your frontend
    "https://fatins.firebaseapp.com/", # The Firebase Hosting URL of your frontend #2
    "http://localhost:3000",   # For local development
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Determine if running locally or on Render
run_local = os.getenv("RENDER") is None  # If the RENDER environment variable is not set, assume local
print(f"Running {'locally' if run_local else 'on Render'}")

# The path to your secret file:
service_account_path = "/etc/secrets/firestoreServiceAccountKey.json"

if run_local:
    cred = credentials.Certificate("firestoreServiceAccountKey.json")
else:
    with open(service_account_path, "r") as f:
        service_account_info = json.load(f)
    cred = credentials.Certificate(service_account_info)

firebase_admin.initialize_app(cred)
db = firestore.client()

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
