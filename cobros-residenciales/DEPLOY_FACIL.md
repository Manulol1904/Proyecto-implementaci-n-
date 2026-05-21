# Despliegue fácil (sin Oracle ni SSH)

Tres niveles de dificultad. Elige según lo que necesites.

| Opción | Tiempo | ¿Siempre online? | Para qué sirve |
|--------|--------|------------------|----------------|
| **A — Enlace rápido** | ~10 min | Solo con tu PC encendida | Mostrar en clase / entregar URL hoy |
| **B — Render + Atlas** | ~30 min | Sí (con pausas en plan free) | **La más sencilla permanente** |
| **C — Oracle + Docker** | ~1 h | Sí | [DEPLOY_GRATIS.md](./DEPLOY_GRATIS.md) (más control) |

---

## Opción A — Enlace rápido (lo más simple de todos)

Tu proyecto ya corre en Docker en el PC. Solo publicas un enlace temporal.

### 1. Levanta el proyecto

```powershell
cd "c:\Users\ferna\OneDrive\Escritorio\tarea de diana\cobros-residenciales"
docker compose --env-file .env up -d
```

Abre http://localhost:5174 y confirma que funciona.

### 2. Instala Cloudflare Tunnel (una vez)

Descarga **cloudflared** para Windows:  
https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

O con winget:

```powershell
winget install --id Cloudflare.cloudflared
```

### 3. Abre 3 túneles (3 ventanas de PowerShell)

Cada comando te da una URL `https://xxxx.trycloudflare.com`. **Cópialas.**

```powershell
# Ventana 1 — Frontend
cloudflared tunnel --url http://localhost:5174

# Ventana 2 — Backend
cloudflared tunnel --url http://localhost:8000

# Ventana 3 — Payments
cloudflared tunnel --url http://localhost:8002
```

### 4. Actualiza `.env` con esas URLs HTTPS

Ejemplo (usa tus URLs reales):

```env
VITE_BACKEND_URL=https://abc-123.trycloudflare.com
VITE_PAYMENTS_URL=https://def-456.trycloudflare.com
CORS_EXTRA_ORIGINS=https://ghi-789.trycloudflare.com
```

(`CORS_EXTRA_ORIGINS` = URL del **frontend**, la ventana 1.)

### 5. Reconstruye el frontend y reinicia

```powershell
docker compose --env-file .env up --build -d frontend
docker restart cobros-residenciales-backend-1
```

### 6. Comparte la URL del frontend

La de la **ventana 1** es la que abres en el celular u otra red.

**Importante:** Si apagas el PC o cierras las ventanas, el enlace deja de funcionar. Para la tarea suele bastar.

---

## Opción B — Render + MongoDB Atlas (recomendada, sin servidor)

Todo por la web: GitHub + Render + Atlas. **No instalas Linux ni SSH.**

### Paso 1 — MongoDB Atlas (10 min, una vez)

1. https://www.mongodb.com/cloud/atlas/register → cluster **M0 FREE**.
2. Usuario + contraseña.
3. Network Access → **Allow access from anywhere** (`0.0.0.0/0`).
4. Copia la URI: `mongodb+srv://usuario:pass@cluster....mongodb.net/...`

### Paso 2 — Sube el código a GitHub

```powershell
cd "c:\Users\ferna\OneDrive\Escritorio\tarea de diana\cobros-residenciales"
git init
git add .
git commit -m "Cobros residenciales"
git remote add origin https://github.com/TU_USUARIO/cobros-residenciales.git
git push -u origin main
```

(No subas el archivo `.env`.)

### Paso 3 — Redis gratis (Upstash)

1. https://upstash.com → cuenta gratis → **Create Redis**.
2. Copia la URL: `rediss://default:xxxx@xxxx.upstash.io:6379`

### Paso 4 — Tres servicios en Render

https://render.com → **Sign up** → conectar GitHub → **New +**

#### 4a) Backend

- **Web Service** → repo `cobros-residenciales`
- Root Directory: `backend`
- Runtime: **Docker**
- Plan: **Free**
- Variables (Environment):

| Key | Value |
|-----|--------|
| `MONGODB_URI` | tu URI de Atlas |
| `REDIS_URL` | tu URL de Upstash |
| `JWT_SECRET` | una clave larga (inventa o `openssl rand -hex 32`) |
| `APP_ENV` | `prod` |
| `CORS_EXTRA_ORIGINS` | *(la llenas después con la URL del frontend)* |
| Factus | las que ya tienes en `.env` si las usas |

Anota la URL que te da Render, ej. `https://cobros-backend.onrender.com`

#### 4b) Payments

- **Web Service** → mismo repo
- Root Directory: `payments`
- Runtime: **Docker**, Plan **Free**
- Mismas variables de Mongo, Redis, JWT, y:

| Key | Value |
|-----|--------|
| `BACKEND_URL` | `https://cobros-backend.onrender.com` |

Anota la URL, ej. `https://cobros-payments.onrender.com`

#### 4c) Frontend

- **Static Site** → mismo repo
- Root Directory: `frontend`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`
- Variables de entorno del build:

| Key | Value |
|-----|--------|
| `VITE_BACKEND_URL` | `https://cobros-backend.onrender.com` |
| `VITE_PAYMENTS_URL` | `https://cobros-payments.onrender.com` |

Anota la URL del static site, ej. `https://cobros-residenciales.onrender.com`

### Paso 5 — CORS

En el servicio **backend** de Render, edita:

`CORS_EXTRA_ORIGINS` = URL exacta del **Static Site** (frontend), con `https://` y sin `/` al final.

Guarda → Render redespliega solo.

### Paso 6 — Worker (opcional en free)

En plan free de Render **no** hay worker Celery siempre activo. Para la demo:

- Genera facturas desde el **panel admin** (botón del mes).
- Las reservas y pagos mock funcionan igual.

Si más adelante necesitas cron automático, usa la guía Oracle ([DEPLOY_GRATIS.md](./DEPLOY_GRATIS.md)) o un plan de pago en Render.

### Paso 7 — Primer usuario

Cuando el backend esté **Live**:

```powershell
curl -X POST https://TU-BACKEND.onrender.com/auth/register -H "Content-Type: application/json" -d "{\"email\":\"admin@conjunto.com\",\"password\":\"Admin12345!\",\"full_name\":\"Admin\",\"role\":\"admin\"}"
```

Entra en la URL del **frontend** con ese correo y contraseña.

### Plan free de Render (qué esperar)

- El sitio **tarda ~1 min** en despertar si nadie lo usa un rato.
- Es normal en la capa gratuita.

---

## ¿Cuál elijo?

- **“Necesito un link hoy para mostrar”** → Opción **A** (túneles + PC encendida).
- **“Quiero URL en internet para la entrega”** → Opción **B** (Render + Atlas).
- **“Quiero todo en un solo servidor Docker”** → [DEPLOY_GRATIS.md](./DEPLOY_GRATIS.md) (Oracle).

---

## Resumen visual (Opción B)

```
[Navegador] → Render Static Site (React)
                 ↓ API
            Render Web Service (backend :8000)
            Render Web Service (payments :8002)
                 ↓
            MongoDB Atlas + Upstash Redis
```

Si quieres, en el siguiente mensaje dime si prefieres **A** (link rápido) o **B** (Render) y te guío paso a paso con tus URLs reales.
