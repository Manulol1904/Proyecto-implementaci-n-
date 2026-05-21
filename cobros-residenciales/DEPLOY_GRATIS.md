# Desplegar en internet (gratis)

> **¿Quieres algo más simple?** Lee primero **[DEPLOY_FACIL.md](./DEPLOY_FACIL.md)** (Render + Atlas sin SSH, o un enlace temporal en 10 minutos).

Tu proyecto tiene **5 piezas**: frontend, backend, payments, worker (Celery + calendario) y Redis. MongoDB va en la nube gratis (**MongoDB Atlas**).

La opción con **más control** (una VM) es:

1. **MongoDB Atlas** (base de datos gratis)  
2. **Oracle Cloud “Always Free”** (una mini VM para Docker)  
3. **Cloudflare Tunnel** (HTTPS público sin pagar dominio)

Alternativa sin VM: Render + Atlas + Upstash (más troceado, ver §4).

---

## Requisitos previos

- Cuenta en [GitHub](https://github.com) (subir el código)
- Cuenta en [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
- Cuenta en [Oracle Cloud](https://www.oracle.com/cloud/free/) (tarjeta para verificación; no cobra si solo usas recursos “Always Free”)

---

## Paso 1 — MongoDB Atlas (gratis)

1. Crea un cluster **M0 FREE** (región cercana a ti, ej. `us-east-1`).
2. **Database Access** → usuario con contraseña (guárdala).
3. **Network Access** → **Add IP Address** → `0.0.0.0/0` (permite conectar desde la VM; para tarea/demo está bien).
4. **Connect** → driver Python → copia la URI, ejemplo:

   `mongodb+srv://usuario:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

5. En tu `.env` de producción:

   ```env
   MONGODB_URI=mongodb+srv://...
   MONGODB_DB=cobros_residenciales
   ```

---

## Paso 2 — Subir el código a GitHub

En tu PC (PowerShell), desde la carpeta del proyecto:

```powershell
cd "c:\Users\ferna\OneDrive\Escritorio\tarea de diana\cobros-residenciales"
git init
git add .
git commit -m "Proyecto cobros residenciales"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/cobros-residenciales.git
git push -u origin main
```

(No subas el archivo `.env` con secretos; ya debería estar en `.gitignore`.)

---

## Paso 3 — VM gratis en Oracle Cloud

1. En Oracle Cloud → **Create a VM instance** (Always Free).
2. Imagen: **Ubuntu 22.04** (o 24.04).
3. Shape: **Ampere** → `VM.Standard.A1.Flex` (1 OCPU, 6 GB RAM basta).
4. Descarga la llave SSH (`.key`) o define contraseña.
5. Abre puertos en **Networking / Security List** (si vas a probar sin túnel):
   - `22` (SSH)
   - `80` (frontend)
   - `8000`, `8002` (API; con túnel Cloudflare no hace falta exponerlos al mundo)

6. Conéctate por SSH (reemplaza IP y ruta de tu llave):

   ```bash
   ssh -i ruta\a\tu.key ubuntu@IP_PUBLICA_DE_LA_VM
   ```

7. Instala Docker en la VM:

   ```bash
   sudo apt update && sudo apt install -y git docker.io docker-compose-v2
   sudo usermod -aG docker $USER
   # Cierra sesión SSH y vuelve a entrar para aplicar el grupo docker
   ```

8. Clona el repo y configura entorno:

   ```bash
   git clone https://github.com/TU_USUARIO/cobros-residenciales.git
   cd cobros-residenciales
   cp .env.production.example .env
   nano .env   # pega MONGODB_URI, JWT_SECRET, Factus si aplica
   ```

9. Genera `JWT_SECRET` (en la VM o en tu PC):

   ```bash
   openssl rand -hex 32
   ```

10. **Importante:** `VITE_BACKEND_URL` y `VITE_PAYMENTS_URL` deben ser las URLs **públicas HTTPS** que usará el navegador (las defines en el paso 4 con Cloudflare). Si aún no las tienes, pon temporalmente `http://IP:8000` y `http://IP:8002`, levanta, luego **reconstruye el frontend** cuando tengas HTTPS:

    ```bash
    docker compose -f docker-compose.prod.yml --env-file .env up --build -d
    ```

11. Crea el admin y demo (desde la VM o tu PC apuntando al backend):

    ```bash
    curl -X POST http://IP_PUBLICA:8000/admin/seed-demo
    ```

    (Si `APP_ENV=prod` bloquea seed-demo, registra admin con `POST /auth/register` y usa el panel.)

12. Abre en el navegador: `http://IP_PUBLICA` (puerto 80 → frontend).

---

## Paso 4 — HTTPS gratis con Cloudflare Tunnel (recomendado)

Así no expones puertos raros y tienes URL `https://...` para CORS y Vite.

1. En la VM, instala `cloudflared`:

   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
   chmod +x cloudflared
   sudo mv cloudflared /usr/local/bin/
   ```

   (En VM ARM Ampere usa el binario `arm64` de la misma página de releases.)

2. Inicia sesión (abre un enlace en el navegador):

   ```bash
   cloudflared tunnel login
   ```

3. Crea túnel y tres rutas (frontend, backend, payments):

   ```bash
   cloudflared tunnel create cobros-residenciales
   ```

   Crea `~/.cloudflared/config.yml` (sustituye `TUNNEL_ID` y los hostnames que elijas):

   ```yaml
   tunnel: TUNNEL_ID
   credentials-file: /home/ubuntu/.cloudflared/TUNNEL_ID.json

   ingress:
     - hostname: app-tu-nombre.trycloudflare.com
       service: http://localhost:80
     - hostname: api-tu-nombre.trycloudflare.com
       service: http://localhost:8000
     - hostname: pay-tu-nombre.trycloudflare.com
       service: http://localhost:8002
     - service: http_status:404
   ```

   Para prueba rápida sin cuenta Cloudflare DNS, puedes usar túneles efímeros:

   ```bash
   cloudflared tunnel --url http://localhost:80
   ```

   (Te da una URL `https://xxxx.trycloudflare.com` temporal; repite para 8000 y 8002 en terminales aparte, o usa config fija arriba.)

4. Actualiza `.env`:

   ```env
   APP_ENV=prod
   VITE_BACKEND_URL=https://api-tu-nombre.trycloudflare.com
   VITE_PAYMENTS_URL=https://pay-tu-nombre.trycloudflare.com
   CORS_EXTRA_ORIGINS=https://app-tu-nombre.trycloudflare.com
   ```

5. Reconstruye solo el frontend (embebe las URLs de Vite):

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env up --build -d frontend
   docker compose -f docker-compose.prod.yml --env-file .env up -d
   ```

6. Ejecuta el túnel como servicio:

   ```bash
   sudo cloudflared service install
   sudo systemctl start cloudflared
   ```

Abre `https://app-tu-nombre...` desde el celular o otra red: ya está en internet.

---

## Paso 5 — Comprobar que todo vive

| URL | Qué debe responder |
|-----|-------------------|
| `https://app-.../` | Login del portal |
| `https://api-.../docs` | Swagger FastAPI |
| `https://api-.../health` | `{"status":"ok"}` |
| `https://pay-.../health` | `{"status":"ok"}` |

En el panel (estado de conexión) deben salir **backend: ok** y **payments: ok**.

---

## §4 Alternativa: Render (sin VM)

Gratis con limitaciones (se “duerme” tras inactividad, arranque lento):

| Servicio | Render |
|----------|--------|
| Frontend | **Static Site** (`npm run build`, publish `dist`) |
| Backend | **Web Service** Docker o Python |
| Payments | **Web Service** |
| Worker | **Background Worker** (en plan free a veces no hay beat; revisa docs actuales) |
| MongoDB | Atlas |
| Redis | [Upstash](https://upstash.com) Redis gratis → `REDIS_URL` |

Variables en cada servicio como en `.env.production.example`.  
`CORS_EXTRA_ORIGINS` = URL del static site de Render.

---

## Checklist de seguridad mínima (prod)

- [ ] `JWT_SECRET` largo y único  
- [ ] `APP_ENV=prod`  
- [ ] No subir `.env` a GitHub  
- [ ] Atlas: restringir IP cuando tengas IP fija de la VM (opcional)  
- [ ] Factus: credenciales sandbox solo para demo  

---

## Problemas frecuentes

**CORS / login falla en HTTPS**  
→ `CORS_EXTRA_ORIGINS` debe ser exactamente la URL del frontend (con `https://`, sin `/` al final). Rebuild backend si cambias `.env`.

**Frontend llama a `localhost:8000` en producción**  
→ Rebuild frontend: `VITE_*` se fijan al **build**, no al arrancar nginx.

**Worker no genera facturas del mes**  
→ Revisa logs: `docker compose -f docker-compose.prod.yml logs worker -f`  
→ Redis debe estar arriba; `REDIS_URL=redis://redis:6379/0`.

**Atlas no conecta**  
→ Usuario/contraseña en URI; Network Access `0.0.0.0/0` o IP de la VM.

---

## Resumen

| Pieza | Gratis con |
|-------|------------|
| Base de datos | MongoDB Atlas M0 |
| App + APIs + worker + Redis | Oracle VM Always Free + Docker |
| HTTPS público | Cloudflare Tunnel |

Con eso puedes entregar la URL del frontend (`https://app-...`) en la tarea y demostrar el sistema en internet sin pagar hosting.
