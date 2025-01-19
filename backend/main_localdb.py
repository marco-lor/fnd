# main_localdb.py
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from backend.database import Base, engine, SessionLocal
from models import Item

# Create DB tables if they don't exist
Base.metadata.create_all(bind=engine)

app = FastAPI()
origins = ["http://localhost:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI"}

@app.get("/items")
def get_items(db: Session = Depends(get_db)):
    items = db.query(Item).all()
    return items

@app.post("/items")
def create_item(name: str, db: Session = Depends(get_db)):
    new_item = Item(name=name)
    db.add(new_item)
    db.commit()
    db.refresh(new_item)
    return new_item

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
