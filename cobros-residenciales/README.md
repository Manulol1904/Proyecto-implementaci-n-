## Cobros residenciales (Colombia) — microservicios Docker

Portal para gestionar cobros de administración por coeficiente, generar facturas mensuales, emitir factura electrónica (Factus) y cobrar en línea (Wompi/ePayco), con control de estados.

### Arquitectura
- **Frontend**: React + Vite + Tailwind (puerto `5173`)
- **Backend**: FastAPI + JWT + MongoDB (local por defecto / Atlas en prod) (puerto `8000`)
- **Worker**: Celery + Redis (genera cobros mensuales + Factus)
- **Payments**: FastAPI (links de pago + webhooks) (puerto `8002`)
- **Redis**: broker/cache

### Requisitos
- Docker Desktop
- Opcional (prod): Un cluster de **MongoDB Atlas** y su `MONGODB_URI`

### Configuración
1. Copia `.env.example` a `.env` y completa variables (en dev ya trae `mongodb://mongo:27017`).
2. Recomendado en dev: `PAYMENTS_PROVIDER=mock` y deja Factus vacío.

### Ejecutar
Desde esta carpeta:

```bash
docker compose --env-file .env up --build
```

Servicios:
- Frontend: `http://localhost:5173`
- Backend docs: `http://localhost:8000/docs`
- Payments docs: `http://localhost:8002/docs`
- Mongo Express (ver BD): `http://localhost:8081`

### Producción (MongoDB Atlas)
1. Configura en `.env` tu `MONGODB_URI` de Atlas (mongodb+srv://...).
2. Define URLs públicas:
   - `VITE_BACKEND_URL=https://tu-dominio-backend`
   - `VITE_PAYMENTS_URL=https://tu-dominio-payments`
3. Levanta con el compose de prod (sin Mongo local):

```bash
docker compose -f docker-compose.prod.yml --env-file .env up --build -d
```

Notas:
- En prod debes poner `JWT_SECRET` fuerte.
- Para webhooks de Wompi/ePayco necesitas URLs **HTTPS públicas** apuntando al servicio `payments`.

### Ver datos en la base de datos (dev)
En Mongo Express revisa estas colecciones:
- `users`: usuarios (admin/resident) y sus `_id` (útil para `resident_user_id`)
- `units`: unidades con `coefficient` y `resident_user_id`
- `invoices`: facturas por `unit_id` + `period`
- `payments`: confirmaciones de pago

### Usuario inicial (dev)
En dev puedes crear un admin con el endpoint:
- `POST /auth/register` con `role=admin`

### Flujo mensual (automatizado)
- El **worker** ejecuta una tarea programada el día 1 de cada mes:
  - Calcula cobros por unidad según `ADMIN_FEE_BASE_COP * coeficiente`
  - Crea la factura en MongoDB
  - Si Factus está configurado, solicita emisión y guarda `pdf_url/xml_url`

### Pagos
- El servicio **payments** crea un `payment_link` (mock o proveedor real)
- El proveedor llama el **webhook** y el sistema marca la factura como **Pagada**

### Notas
- **Estados de factura**: `Pendiente`, `Pagada`, `Vencida`
- Para pasar a integración real: configura claves de Factus y Wompi/ePayco en `.env`.

### Seguridad (pagos + descargas)
- `POST /payments` ahora requiere **JWT** (header `Authorization: Bearer <token>`) y valida **ownership**:
  - un **resident** solo puede pagar facturas de sus unidades asignadas
  - un **admin** puede generar pagos para cualquier factura
- La descarga de **PDF/XML** se hace vía backend con proxy autenticado:
  - `GET /invoices/{id}/pdf`
  - `GET /invoices/{id}/xml`
