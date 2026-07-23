"""Credential-free FastAPI health surface."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://fatins.web.app",
        "https://fatins.firebaseapp.com",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "Hello from FastAPI - DnD Game Backend!"}


@app.get("/healthz")
def read_healthz() -> dict[str, str]:
    return {"status": "ok", "service": "fnd-backend"}
