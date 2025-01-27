# uvicorn main:app --reload --host 127.0.0.1 --port 8000
# uvicorn main:app --reload
# file ./backend/main.py

from fast_api import app

@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI - DnD Game Backend!"}
