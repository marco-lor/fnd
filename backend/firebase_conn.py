# file ./backend/firebase_conn.py
# import firebase_admin
from firebase_admin import credentials, firestore, initialize_app
import json
import os

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

initialize_app(cred)
db = firestore.client()