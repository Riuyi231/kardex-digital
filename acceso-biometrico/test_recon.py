import requests

BASE = "http://127.0.0.1:8000"

# Limpiar personas previas
prev = requests.get(BASE + "/api/personas").json()["data"]
for p in prev:
    requests.delete(BASE + "/api/personas/%d" % p["id"])

# Registrar a Obama
r = requests.post(BASE + "/api/personas",
    data={"nombre": "OBAMA", "apellido": "TEST", "cedula": "000-0000000-1", "rol": "empleado"},
    files={"foto": ("obama.jpg", open("data/test_obama.jpg", "rb"), "image/jpeg")})
print("registrar OBAMA:", r.status_code, r.json()["ok"])

def detectar(archivo):
    r = requests.post(BASE + "/api/detectar", files={"imagen": (archivo, open("data/" + archivo, "rb"), "image/jpeg")})
    j = r.json()
    if j.get("encontrado"):
        p = j["encontrado"]["persona"]
        return "MATCH %s %s (%.1f%%)" % (p["nombre"], p["apellido"], j["encontrado"]["confianza"] * 100)
    return "NO MATCH (rostros=%d)" % len(j.get("rostros", []))

print("misma persona (obama) ->", detectar("test_obama.jpg"))
print("otra persona (biden)  ->", detectar("test_biden.jpg"))
