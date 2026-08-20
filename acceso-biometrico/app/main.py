import os
import time
import uuid
from datetime import datetime

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional, List

from . import db
from .config import STATIC_DIR, FOTOS_DIR, COOLDOWN_SEGUNDOS
from .vision import FaceEngine

engine = FaceEngine()

_ultimo_evento = {}

app = FastAPI(title="NexGuard - Control de Acceso")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

db.init_db()


def ahora():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def hoy():
    return datetime.now().strftime("%Y-%m-%d")


def _public_persona(p):
    return {k: p.get(k) for k in ("id", "nombre", "apellido", "cedula", "rol", "foto", "creado")}


# ---------------- Personas ----------------

@app.get("/api/personas")
def listar_personas():
    rows = db.query("SELECT * FROM personas ORDER BY nombre COLLATE NOCASE ASC")
    return {"ok": True, "data": [_public_persona(r) for r in rows]}


@app.post("/api/personas")
def registrar_persona(
    nombre: str = Form(...),
    apellido: str = Form(""),
    cedula: str = Form(""),
    rol: str = Form("empleado"),
    foto: UploadFile = File(...),
):
    nombre = nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    data = foto.file.read()
    img = engine.decode_img(data)
    if img is None:
        raise HTTPException(400, "No se pudo leer la imagen")
    rostros = engine.detect(img)
    if not rostros:
        raise HTTPException(400, "No se detectó ningún rostro en la foto. Usa una foto clara de frente.")
    box = rostros[0]["box"]
    emb = engine.embed(img, rostros[0]["landmarks"])
    if emb is None:
        raise HTTPException(400, "No se pudo calcular el rostro de la foto")
    ext = os.path.splitext(foto.filename or "foto.jpg")[1].lower() or ".jpg"
    fid = uuid.uuid4().hex[:10]
    fname = "p%s%s" % (fid, ext)
    with open(os.path.join(FOTOS_DIR, fname), "wb") as f:
        f.write(data)
    pid = db.execute(
        "INSERT INTO personas (nombre, apellido, cedula, rol, foto, embedding, creado) VALUES (?,?,?,?,?,?,?)",
        (nombre, apellido, cedula.strip(), rol, fname, engine.embedding_to_b64(emb), ahora()),
    )
    p = db.query("SELECT * FROM personas WHERE id = ?", (pid,))[0]
    return {"ok": True, "data": _public_persona(p)}


@app.delete("/api/personas/{pid}")
def eliminar_persona(pid: int):
    p = db.query("SELECT * FROM personas WHERE id = ?", (pid,))
    if not p:
        raise HTTPException(404, "Persona no encontrada")
    foto = p[0].get("foto")
    if foto:
        try:
            os.remove(os.path.join(FOTOS_DIR, foto))
        except OSError:
            pass
    db.execute("DELETE FROM personas WHERE id = ?", (pid,))
    return {"ok": True}


@app.get("/api/foto/{pid}")
def foto_persona(pid: int):
    rows = db.query("SELECT foto FROM personas WHERE id = ?", (pid,))
    if not rows or not rows[0].get("foto"):
        raise HTTPException(404, "Sin foto")
    p = os.path.join(FOTOS_DIR, rows[0]["foto"])
    if not os.path.exists(p):
        raise HTTPException(404, "Foto no encontrada")
    return FileResponse(p)


# ---------------- Detección / identificación ----------------

@app.post("/api/detectar")
async def detectar(imagen: UploadFile = File(...)):
    data = await imagen.read()
    img = engine.decode_img(data)
    if img is None:
        return {"ok": False, "error": "Imagen inválida", "rostros": []}
    rostros = engine.detect(img)
    personas = db.query("SELECT * FROM personas WHERE embedding != ''")
    resultados = []
    encontrado = None
    for r in rostros:
        emb = engine.embed(img, r["landmarks"])
        item = {**r, "persona": None, "confianza": None}
        if emb is not None:
            m = engine.match(emb, personas)
            if m:
                item["persona"] = _public_persona(m["persona"])
                item["confianza"] = m["confianza"]
                if encontrado is None or m["confianza"] > encontrado["confianza"]:
                    encontrado = {"persona": item["persona"], "confianza": m["confianza"]}
        resultados.append(item)
    return {"ok": True, "rostros": resultados, "encontrado": encontrado}


# ---------------- Eventos ----------------

class EventoIn(BaseModel):
    persona_id: Optional[int] = None
    nombre: Optional[str] = None
    tipo: Optional[str] = None
    metodo: str = "rostro"
    confianza: float = 0.0
    alerta: str = ""


@app.post("/api/eventos")
def registrar_evento(ev: EventoIn):
    persona = None
    if ev.persona_id:
        rows = db.query("SELECT * FROM personas WHERE id = ?", (ev.persona_id,))
        if rows:
            persona = rows[0]
    nombre = ev.nombre or (persona["nombre"] + (" " + persona["apellido"] if persona.get("apellido") else "")).strip() if persona else (ev.nombre or "Desconocido")

    if persona:
        ultimo = _ultimo_evento.get(persona["id"])
        if ultimo and (time.time() - ultimo) < COOLDOWN_SEGUNDOS:
            return {"ok": True, "data": {"cooldown": True, "segundos": int(COOLDOWN_SEGUNDOS - (time.time() - ultimo))}}
        _ultimo_evento[persona["id"]] = time.time()

        tipo = ev.tipo
        if not tipo:
            ult = db.query("SELECT tipo FROM eventos WHERE persona_id = ? ORDER BY id DESC LIMIT 1", (persona["id"],))
            tipo = "salida" if (ult and ult[0]["tipo"] == "entrada") else "entrada"
        pid = db.execute(
            "INSERT INTO eventos (persona_id, persona_nombre, tipo, metodo, confianza, alerta, creado) VALUES (?,?,?,?,?,?,?)",
            (persona["id"], nombre, tipo, ev.metodo, ev.confianza, ev.alerta, ahora()),
        )
        return {"ok": True, "data": {"cooldown": False, "evento": db.query("SELECT * FROM eventos WHERE id = ?", (pid,))[0]}}

    if ev.alerta:
        db.execute(
            "INSERT INTO eventos (persona_id, persona_nombre, tipo, metodo, confianza, alerta, creado) VALUES (NULL,?,?,?,?,?,?)",
            (nombre, "alerta", ev.metodo, ev.confianza, ev.alerta, ahora()),
        )
    return {"ok": True, "data": {"cooldown": False, "evento": None}}


@app.get("/api/eventos")
def listar_eventos(limite: int = 30):
    rows = db.query("SELECT * FROM eventos ORDER BY id DESC LIMIT ?", (min(limite, 300),))
    return {"ok": True, "data": rows}


# ---------------- Dashboard ----------------

@app.get("/api/dashboard")
def dashboard():
    personas = db.query("SELECT * FROM personas")
    eventos = db.query("SELECT * FROM eventos ORDER BY id DESC LIMIT 500")
    dentro = []
    visto = {}
    for ev in reversed(eventos):
        if not ev["persona_id"] or ev["persona_id"] in visto:
            continue
        if ev["tipo"] == "entrada":
            visto[ev["persona_id"]] = ev
        elif ev["tipo"] == "salida" and ev["persona_id"] in visto:
            del visto[ev["persona_id"]]
    for pid, ev in visto.items():
        p = next((x for x in personas if x["id"] == pid), None)
        if p:
            dentro.append({**_public_persona(p), "desde": ev["creado"]})
    h = hoy()
    hoy_ev = [e for e in eventos if (e["creado"] or "")[:10] == h]
    return {
        "ok": True,
        "data": {
            "dentro": dentro,
            "personas": len(personas),
            "hoy_entradas": sum(1 for e in hoy_ev if e["tipo"] == "entrada"),
            "hoy_salidas": sum(1 for e in hoy_ev if e["tipo"] == "salida"),
            "alertas": sum(1 for e in hoy_ev if e["tipo"] == "alerta"),
            "ultimos": eventos[:15],
            "cooldown": COOLDOWN_SEGUNDOS,
        },
    }


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
