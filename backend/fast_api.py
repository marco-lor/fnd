# file ./backend/fast_api.py
from fastapi import FastAPI
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