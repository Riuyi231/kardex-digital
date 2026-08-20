import os
import sqlite3
import threading

from .config import DATA_DIR, DB_PATH, FOTOS_DIR

_lock = threading.Lock()

def _conn():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    os.makedirs(FOTOS_DIR, exist_ok=True)
    with _lock:
        conn = _conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS personas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                apellido TEXT DEFAULT '',
                cedula TEXT DEFAULT '',
                rol TEXT DEFAULT 'empleado',
                foto TEXT DEFAULT '',
                embedding TEXT DEFAULT '',
                creado TEXT
            );
            CREATE TABLE IF NOT EXISTS eventos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                persona_id INTEGER,
                persona_nombre TEXT DEFAULT '',
                tipo TEXT NOT NULL,
                metodo TEXT DEFAULT 'rostro',
                confianza REAL DEFAULT 0,
                alerta TEXT DEFAULT '',
                creado TEXT
            );
        """)
        conn.commit()
        conn.close()

def query(sql, params=()):
    with _lock:
        conn = _conn()
        rows = conn.execute(sql, params).fetchall()
        conn.close()
        return [dict(r) for r in rows]

def execute(sql, params=()):
    with _lock:
        conn = _conn()
        cur = conn.execute(sql, params)
        conn.commit()
        last = cur.lastrowid
        conn.close()
        return last
