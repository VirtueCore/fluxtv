import os
import threading
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import DATABASE_PATH

class Base(DeclarativeBase):
    pass

# Global lock to serialize write operations (prevents SQLite lock contention)
db_write_lock = threading.Lock()

connect_args = {
    "check_same_thread": False,
    "timeout": 60,  # Wait up to 60 seconds if database is locked
}

engine = create_engine(
    f"sqlite:///{DATABASE_PATH}",
    connect_args=connect_args,
    echo=False,
    pool_pre_ping=True,
)

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA busy_timeout=60000;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    from . import models  # noqa
    with engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL;"))
        conn.execute(text("PRAGMA busy_timeout=60000;"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
