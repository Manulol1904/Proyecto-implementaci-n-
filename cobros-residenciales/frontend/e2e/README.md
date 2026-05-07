# Tests E2E (Selenium)

Estos tests cubren el frontend con navegador real (Selenium) contra los servicios locales.

## Requisitos

- Node 18+ para `npm run dev`
- Python 3.10+
- Backend en `http://localhost:8000` y Payments en `http://localhost:8002`

## Setup

```bash
cd cobros-residenciales/frontend/e2e
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

## Correr

1) Levantar el frontend:

```bash
cd cobros-residenciales/frontend
npm install
npm run dev
```

2) En otra terminal, correr E2E:

```bash
cd cobros-residenciales/frontend/e2e
.\.venv\Scripts\activate
pytest -m e2e
```

## Variables de entorno

- `FRONTEND_URL`: URL del frontend (Vite)
- `BACKEND_URL`: API backend (para sembrar demo y autenticar)
- `PAYMENTS_URL`: API payments (no es obligatorio para los smoke tests)
- `BROWSER`: `chrome` o `edge`
- `HEADLESS`: `1` para headless, `0` para ver el navegador

