## Cobros residenciales (Colombia) — microservicios Docker

Portal para administrar la vida del conjunto: cobros de administración por coeficiente, **reservas de amenidades** (parqueadero de visitantes y salón comunal), **suscripciones del gimnasio**, facturación electrónica (**Factus API**) y registro de pagos vía API interna (`payments`).

### Arquitectura
- **Frontend**: React + Vite + Tailwind (puerto host `5174` en dev con Docker; `5173` dentro del contenedor)
- **Backend**: FastAPI + JWT + MongoDB (local por defecto / Atlas en prod) (puerto `8000`)
- **Worker**: Celery + Redis (genera cobros mensuales + Factus)
- **Payments**: FastAPI (links de pago + webhooks) (puerto `8002`)
- **Redis**: broker/cache
- **Mongo Express** (solo dev): visor de BD (puerto `8081`)

### Requisitos
- Docker Desktop
- Opcional (prod): cluster de **MongoDB Atlas** con su `MONGODB_URI`

### Configuración
1. Copia `.env.example` a `.env` y completa variables (en dev ya trae `mongodb://mongo:27017`).
2. Recomendado en dev: deja Factus vacío si no tienes credenciales sandbox.
3. Variables nuevas relacionadas con reservas / gimnasio:
   - `VISITOR_PARKING_HOURLY_COP` (por hora, default `2000`)
   - `SOCIAL_HALL_DAILY_COP` (por día, default `150000`)
   - `GYM_MONTHLY_COP` (mensual, default `40000`)
4. Variables de automatización:
   - `RESERVATION_PENDING_EXPIRE_MINUTES` (default `30`)
   - `PAYMENT_RECONCILE_AFTER_MINUTES` (default `30`, solo aplica a `APP_ENV=dev`)
   - `FACTUS_RETRY_LIMIT` (default `25`)
   - `BACKEND_INTERNAL_URL` / `PAYMENTS_INTERNAL_URL` para health-check interno del worker

### Ejecutar
Desde esta carpeta:

```bash
docker compose --env-file .env up --build
```

Servicios:
- Frontend: `http://localhost:5174`
- Backend docs: `http://localhost:8000/docs`
- Payments docs: `http://localhost:8002/docs`
- Mongo Express (ver BD): `http://localhost:8081`

### Hot reload en desarrollo
El servicio `frontend` monta el código fuente como bind mount (`./frontend:/app`) y usa `CHOKIDAR_USEPOLLING=true` para que el watcher funcione bien en Windows + Docker. Esto permite **Vite HMR** sin reconstruir imagen al editar `*.tsx` / `*.css`. Si tocas `tailwind.config.js`, Vite hace un reload completo (esperado).

### Desplegar gratis en internet

- **Más sencillo:** **[DEPLOY_FACIL.md](./DEPLOY_FACIL.md)** (Render + Atlas, o enlace temporal con tu PC).
- **Con servidor propio:** **[DEPLOY_GRATIS.md](./DEPLOY_GRATIS.md)** (Oracle VM + Docker).

### Producción (MongoDB Atlas)
1. Configura en `.env` tu `MONGODB_URI` de Atlas (`mongodb+srv://...`).
2. Define URLs públicas:
   - `VITE_BACKEND_URL=https://tu-dominio-backend`
   - `VITE_PAYMENTS_URL=https://tu-dominio-payments`
3. Levanta con el compose de prod (sin Mongo local):

```bash
docker compose -f docker-compose.prod.yml --env-file .env up --build -d
```

Notas:
- En prod debes poner `JWT_SECRET` fuerte.
### Ver datos en la base de datos (dev)
En Mongo Express revisa estas colecciones:
- `users` — usuarios (admin/resident) y sus `_id` (útil para `resident_user_id`)
- `units` — unidades con `coefficient` y `resident_user_id`
- `invoices` — facturas por `unit_id` + `period`
- `payments` — confirmaciones de pago (genéricas, ver más abajo)
- `amenities` — amenidades reservables (parqueadero visitante / salón comunal)
- `reservations` — reservas por residente, con `status`, `start_at`, `end_at`, `amount_cop`
- `gym_subscriptions` — suscripciones mensuales del gimnasio, idempotentes por `(user_id, period)`

### Usuario inicial y demo (dev)
- Crear admin manual: `POST /auth/register` con `role=admin`.
- Atajo de demo: botón **Crear demo** en el panel admin → invoca `POST /admin/seed-demo` y deja sembrado:
  - 1 admin + 3 residentes (Ana, Bruno, Camila) con contraseñas conocidas.
  - 3 unidades con coeficiente y residente asignado.
  - Facturas del mes actual.
  - Amenidades de muestra: `VIS-01 / VIS-02 / VIS-03` (parqueadero visitantes) y `SALON-A` (salón comunal).

### Automatizaciones del worker
El **worker** usa Celery Beat con Redis y ejecuta procesos recurrentes:

- **Día 1, 05:00 UTC (00:00 Colombia)** — `generate_monthly_invoices`:
  - Calcula cobros por unidad según `ADMIN_FEE_BASE_COP * coeficiente`.
  - Crea la factura en MongoDB de forma idempotente (no duplica por `unit_id + period`).
  - Si Factus está configurado, solicita emisión y guarda `pdf_url/xml_url`.
- **Día 1, 05:10 UTC** — `create_monthly_gym_subscriptions`:
  - Si un usuario pagó gimnasio el mes anterior, crea automáticamente la suscripción `Pendiente` del mes actual.
- **Diario, 06:00 UTC** — `mark_overdue_invoices`:
  - Marca como `Vencida` toda factura `Pendiente` con `due_date` vencido.
- **Cada 15 minutos** — `cancel_stale_pending_reservations`:
  - Cancela reservas `Pendiente` sin pago después de `RESERVATION_PENDING_EXPIRE_MINUTES` (default `30`) para liberar parqueadero/salón.
- **Cada 6 horas** — `retry_factus_errors`:
  - Reintenta emisión Factus para errores transitorios, evitando casos de `missing_tax_profile_for_factus`.
- **Cada hora** — `reconcile_mock_payments`:
  - En `APP_ENV=dev`, confirma pagos mock que quedaron `created` después de `PAYMENT_RECONCILE_AFTER_MINUTES` (default `30`).
- **Cada hora** — `precompute_metrics`:
  - Precalcula métricas de facturas, reservas y gimnasio en la colección `metrics`.
- **Cada 5 minutos** — `health_check`:
  - Registra salud de Mongo, backend y payments en `system_health_checks`.

Cada tarea deja una traza en `automation_runs` con el resultado resumido.

### Pagos (genéricos)
El servicio **payments** ya no está atado a facturas: soporta pagar cualquier `target_kind`:
- `invoice` (cuota de administración)
- `reservation` (reserva de amenidad)
- `gym_subscription` (suscripción mensual del gimnasio)

Flujo:
1. El frontend hace `POST /payments` con `{ target_kind, target_id, provider }`.
2. El servicio valida ownership (un residente solo puede pagar lo suyo), genera el `payment_link` y persiste el target en el documento.
3. El frontend confirma el pago con `POST /mock/confirm/{payment_id}` (o webhook genérico `POST /webhooks/mock`) y se marca el target como **Pagada**.

Compatibilidad: el frontend antiguo que enviaba solo `invoice_id` se sigue aceptando (se normaliza a `target_kind=invoice`).

### Frontend — features destacadas

#### Login residencial
- Layout de dos columnas con panel oscuro a la izquierda y formulario claro a la derecha.
- Elementos alusivos a residencias: chips de **Portería / Visitantes / Gimnasio / Salón comunal / Parqueaderos**, tarjetas con iconos de Apartamentos, Áreas comunes y Seguridad.
- Imagen del conjunto residencial como **fondo animado** (zoom/pan lento de 22 s) con overlay morado/blanco que mantiene la paleta.
- Respeta `prefers-reduced-motion`.

#### Layout principal
- **Sidebar fija** (`fixed inset-y-0 left-0 w-64`) con navegación por íconos.
- **Topbar** con título dinámico según sección, avatar, **toggle de tema** y "Cerrar sesión".
- Una única fuente de verdad para la sección activa: `SectionProvider` (`src/lib/section.tsx`). Tanto el sidebar como los dashboards comparten estado vía `useSection()`, así no hay tabs duplicados.
- En móvil (`< lg`) la sidebar se oculta y aparece un `<select>` para cambiar de sección.

#### Tema claro / oscuro
- **Toggle sol/luna** en el TopBar. La preferencia se guarda en `localStorage`; si no hay preferencia, respeta `prefers-color-scheme` del sistema.
- Implementado con **CSS variables** detrás de los tokens `app-*` de Tailwind: el cambio es instantáneo, sin re-renders ni clases `dark:` por toda la app.
- Paleta semántica para banners de estado: `app-danger-*`, `app-success-*`, `app-warning-*` con valores duales.
- Las gráficas (`MiniChart`) leen sus colores de CSS vars (`--chart-primary`, `--chart-warning`, `--chart-success`) y se adaptan al tema.
- Sombras de cards: drop-shadow en claro; sombra interior + halo en oscuro para no perder profundidad.

#### Dashboard admin — secciones
- **Facturas**: resumen mensual + filtros, generación de cobros, reintento Factus, marcar como pagada manualmente.
- **Usuarios**: alta de residentes, gestión de credenciales y `tax_profile` (Factus).
- **Unidades**: CRUD de unidades y asignación de residente.
- **Amenidades**: alta / activar / desactivar / eliminar parqueaderos y salones.
- **Reservas**: listado con filtros por `status`/`type`, cancelar y eliminar.
- **Gimnasio**: listado de suscripciones por mes, eliminar.

UX:
- Estado `busyId` por fila → solo el botón pulsado se deshabilita, no toda la UI.
- `refresh()` selectivo por sección (no recarga las 7 colecciones por cada acción).

#### Dashboard residente
- Tabs: **Mis facturas**, **Parqueadero**, **Salón comunal**, **Gimnasio**.
- Reservar amenidades con validación de solapamiento (la valida también el backend).
- Las reservas de parqueadero pagadas muestran un **PIN de acceso** para portería.
- Suscripción de gimnasio idempotente por mes.
- Pago en línea con polling al `provider` para reflejar el estado en tiempo real.

### Backend — endpoints añadidos
- `GET/POST/PATCH/DELETE /amenities` — CRUD admin + listado para residentes con filtros `type` / `active`.
- `GET /amenities/{id}/availability?from=&to=` — chequea solapamiento.
- `POST /reservations` — crea reserva (calcula amount según el tipo, valida solape). Si es parqueadero de visitantes, genera `access_pin`.
- `GET /reservations` (admin) y `GET /reservations/my` (residente).
- `POST /reservations/{id}/cancel`, `DELETE /reservations/{id}`.
- `POST /gym/subscriptions` (idempotente por mes), `GET /gym/subscriptions/my`, `GET /gym/subscriptions` (admin).

Modelos clave (en `backend/app/domain/`):
- `AmenityType = visitor_parking | social_hall`
- `ReservationStatus = Pendiente | Pagada | Cancelada`
- `GymSubscriptionStatus = Pendiente | Pagada`
- `PaymentTargetKind = invoice | reservation | gym_subscription`

### Seguridad (pagos + descargas)
- `POST /payments` requiere **JWT** (header `Authorization: Bearer <token>`) y valida **ownership** según `target_kind`:
  - un **resident** solo puede pagar facturas de sus unidades / reservas / suscripciones propias.
  - un **admin** puede generar pagos para cualquier target.
- Descarga de **PDF/XML** de factura vía backend con proxy autenticado:
  - `GET /invoices/{id}/pdf`
  - `GET /invoices/{id}/xml`

### Notas
- **Estados de factura**: `Pendiente`, `Pagada`, `Vencida`.
- Para facturación electrónica real: configura credenciales de **Factus** en `.env`.
- Imagen de fondo del login en `frontend/public/residential-bg.png` (reemplazable).

### Estructura relevante del frontend
```
frontend/src/
├─ App.tsx                 Shell + Sidebar + TopBar + ThemeToggle
├─ styles.css              Variables CSS light/dark + fondo animado
├─ lib/
│  ├─ api.ts               Axios instances con auth
│  ├─ auth.ts              Token utils
│  ├─ section.tsx          SectionProvider / useSection()
│  └─ theme.tsx            ThemeProvider / useTheme()
├─ components/
│  ├─ Card.tsx             Card temática (usa tokens app-*)
│  ├─ Button.tsx           Botón primario morado
│  └─ ConnectionStatus.tsx Pills con tokens semánticos
└─ pages/
   ├─ LoginPage.tsx        Login residencial con fondo animado
   ├─ admin/AdminDashboard.tsx
   └─ resident/ResidentDashboard.tsx
```
