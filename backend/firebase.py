import os
import firebase_admin
from firebase_admin import credentials, firestore

# Load the path to your service account JSON from an environment variable
# e.g. FIREBASE_KEY_PATH="/path/to/service_account.json"
firebase_key_path = os.getenv("firestoreServiceAccountKey.json")

# Initialize the Firebase app only once
if not firebase_admin._apps:
    cred = credentials.Certificate(firebase_key_path)
    firebase_admin.initialize_app(cred)

db = firestore.client()
