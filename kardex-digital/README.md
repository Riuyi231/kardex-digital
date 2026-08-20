# KARDEX Digital

Sistema de escritorio (Electron) para Recursos Humanos que gestiona expedientes de empleados a partir de la **cédula dominicana**. Carga el frente y reverso desde un **PDF escaneado o imagen**, muestra vista previa editable, extrae los datos con **OCR (tesseract.js)**, la **zona MRZ** de la cédula (cédula, nombres, sexo, fecha de nacimiento, vencimiento, nacionalidad) y el **código de barras Code 128**, y los guarda en una base **SQLite** local con 3 roles de usuario.

## Credenciales por defecto

| Usuario  | Contraseña | Rol      | Permisos                                       |
|----------|------------|----------|------------------------------------------------|
| `admin`  | `admin123` | Admin    | Todo: expedientes, usuarios y bitácora         |
| `editor` | —          | Editor   | Ver y editar expedientes (crea/edita/elimina)  |
| `invitado`| —         | Invitado | Solo lectura de expedientes                    |

> El administrador puede crear usuarios `editor` e `invitado` desde el panel **Usuarios**. Se recomienda cambiar la contraseña del admin en producción.

## Extracción con IA (opcional)

El sistema trae dos motores de lectura que conviven:

1. **Local (predeterminado)**: OCR (tesseract.js) + zona MRZ + código de barras. Gratis y offline.
2. **IA (OpenAI)**: botón **✨ Extraer con IA** en el formulario de expediente. Envía las imágenes del frente/reverso a `gpt-4o-mini` y rellena los campos con mayor precisión.

Para habilitarlo, defina la clave antes de abrir la app:

```powershell
$env:OPENAI_API_KEY = "sk-..."
npm start
```

Si la variable no está definida, el botón se oculta automáticamente. El OCR local nunca se elimina; la IA es un complemento para refinar los datos.

## Instalación

```bash
npm install
npm run tessdata   # descarga los datos OCR en español (spa.traineddata)
npm start          # abre la aplicación
```

## Uso

1. Inicie sesión con `admin` / `admin123`.
2. En **Empleados**, pulse **+ Nuevo registro**.
3. Pulse **Cargar cédula (PDF / imagen)** y seleccione el archivo escaneado.
4. El sistema renderiza frente y reverso, decodifica el código de barras y rellena los campos automáticamente (todo editable a mano).
5. Pulse **Guardar expediente**. El reverso puede cargarse por separado con **Cargar reverso**.
6. El panel **Usuarios** (solo admin) crea cuentas y asigna roles. La **Bitácora** (solo admin) registra toda la actividad.

## Roles

- **Admin**: gestiona expedientes, usuarios, roles y ve la bitácora.
- **Editor**: crea, edita y elimina expedientes. No gestiona usuarios.
- **Invitado**: consulta expedientes en modo solo lectura.

## Stack técnico

- **Electron 37** (ventana con `contextIsolation`, sin `nodeIntegration`; IPC seguro vía `preload.js`).
- **sql.js** (SQLite en WebAssembly, sin módulos nativos que compilen).
- **tesseract.js 5** (OCR español; worker parcheado en `resources/tesseract-worker.js`).
- **pdfjs-dist** (render de PDF → imagen) + **@napi-rs/canvas** (bindings precargados, sin compilación).
- **@zxing/library** (decodificación Code 128 con detección de crop).

> La máquina de desarrollo no tiene Visual Studio C++: por eso se evitan módulos nativos que requieran compilar (`better-sqlite3`, `canvas`).

## Estructura

```
kardex-digital/
├─ main.js                # Ventana + handlers IPC
├─ preload.js             # API expuesta al renderer
├─ renderer/              # UI (HTML/CSS/JS)
├─ services/
│  ├─ db.js               # SQLite: schema, CRUD, auth, auditoría
│  ├─ pdf.js              # PDF → imágenes / RGBA
│  ├─ ocr.js              # tesseract.js (worker)
│  ├─ barcode.js          # decode Code 128 + crop
│  ├─ parse-cedula.js     # parser de campos OCR + MRZ
│  ├─ ai-shared.js         # prompt/parseo compartidos (JSON, cédula)
│  ├─ ai-extract.js        # extracción con OpenAI (vía OPENAI_API_KEY)
│  ├─ ai-gemini.js         # extracción con Gemini (vía GEMINI_API_KEY, gratis)
│  └─ cedula.js           # orquestador processFile()
├─ resources/
│  ├─ tessdata/spa.traineddata.gz
│  └─ tesseract-worker.js
├─ scripts/
│  ├─ make-test-cedula.js # genera test/cedula-prueba.pdf
│  └─ test-integration.js # test end-to-end del pipeline
└─ test/cedula-prueba.pdf
```

## Pruebas

```bash
node scripts/test-integration.js   # pipeline OCR + código de barras + BD
npx electron . --smoke             # verifica que la ventana carga
```

## Datos

La base de datos se guarda en la carpeta de datos del usuario (`userData`) como `data/kardex.db`. Para aislarla, defina la variable de entorno `KARDEX_DATA_DIR`.

## Extracción con IA

Las claves van en un archivo `.env` (junto a `main.js`, no se sube a git):

```
OPENAI_API_KEY=sk-...        # OpenAI (opcional)
GEMINI_API_KEY=AIza...       # Gemini, gratis: https://aistudio.google.com/apikey
```

En el modal de expediente, el botón **✨ Extraer con IA** usa el proveedor elegido en el desplegable (si hay más de uno). Si no hay ningún proveedor configurado, el botón está oculto.
