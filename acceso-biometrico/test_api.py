import requests

BASE = "http://127.0.0.1:8000"
foto = open("data/test_lena.jpg", "rb")

r = requests.post(BASE + "/api/personas",
    data={"nombre": "STIVEN", "apellido": "PRUEBA", "cedula": "001-1234567-8", "rol": "administrador"},
    files={"foto": ("lena.jpg", foto, "image/jpeg")})
print("registrar:", r.status_code, r.json())
foto.close()

pid = r.json()["data"]["id"]

r = requests.post(BASE + "/api/detectar", files={"imagen": ("lena.jpg", open("data/test_lena.jpg", "rb"), "image/jpeg")})
j = r.json()
print("detectar ok:", j.get("ok"), "rostros:", len(j.get("rostros", [])))
print("encontrado:", j.get("encontrado"))

r = requests.post(BASE + "/api/eventos", json={"persona_id": pid, "metodo": "rostro", "confianza": 0.95})
print("evento 1:", r.json())

r = requests.post(BASE + "/api/eventos", json={"persona_id": pid})
print("evento 2 (toggle):", r.json())

r = requests.get(BASE + "/api/dashboard")
print("dashboard dentro:", [x["nombre"] for x in r.json()["data"]["dentro"]],
      "| entradas hoy:", r.json()["data"]["hoy_entradas"],
      "| salidas hoy:", r.json()["data"]["hoy_salidas"])
