# Cobros residenciales — lógica de negocio, calendario y demo “en gira”

Este documento resume **cómo piensa el sistema**, **qué fechas usa** y una **checklist corta** para demostrarlo o revisarlo sin depender de documentación larga.

---

## 1. Modelo mental (qué existe en el sistema)

| Concepto | Rol |
|----------|-----|
| **Usuario admin** | Gestiona residentes, unidades, facturas y reportes. |
| **Usuario residente** | Ve solo las facturas de las **unidades** que tiene asignadas. |
| **Unidad** | Ej. apartamento (`APT-101`). Tiene **coeficiente de copropiedad** \(0 \< coef ≤ 1\). Opcionalmente tiene **residente asignado**. |
| **Factura** | Una cuota mensual por **unidad** y **periodo** (`YYYY-MM`). Estado: Pendiente → Pagada; o Pendiente → **Vencida** si pasa la fecha límite. |
| **Pago** | Orquestado por el servicio **payments** (API interna). Al confirmarse, la factura pasa a **Pagada**. La factura electrónica DIAN va por **Factus**. |
| **Facturación electrónica (Factus)** | Administración, parqueadero, salón comunal y gimnasio. Tras pagar reserva/gym (o generar cuota mensual), el worker emite en Factus si hay credenciales y **perfil fiscal** completo. |

**Regla de visibilidad:** el residente no “posee” facturas por su cuenta; las ve porque su `user_id` está en `resident_user_id` de la unidad asociada a la factura.

---

## 2. Lógica de cobro (números y reglas)

### 2.1 Cuota base y monto por unidad

- **`ADMIN_FEE_BASE_COP`** (por defecto `300000`): valor de referencia mensual de administración en COP (configuración global).
- **`amount_cop`** por unidad:

\[
\text{monto} = \text{round}(\text{ADMIN\_FEE\_BASE\_COP} \times \text{coeficiente})
\]

Implementación: `amount_for_unit` en `backend/app/utils/billing.py`.

### 2.2 Periodo de facturación

- El periodo es **siempre calendario mensual**: clave **`YYYY-MM`** (año-mes).
- Si no indicas periodo al generar, se usa **el mes actual en UTC**.

### 2.3 Fecha de vencimiento

- **`INVOICE_DUE_DAY`** (por defecto `10`): día del mes en que vence la cuota **de ese periodo**.
- El sistema **clampa** el día entre **1 y 28** para evitar meses cortos (29–31): no se usan día 29/30/31 como vencimiento configurable.
- Hora de vencimiento: **23:59:59 UTC** del día configurado (`due_date_for_period` en `backend/app/utils/billing.py`).

### 2.4 Idempotencia (no duplicar facturas)

- Identificador de factura: `inv_{YYYY-MM}_{unit_id}`.
- Si ya existe una factura para esa unidad y ese mes, **insert ignora duplicado** y cuenta como “skipped”.

### 2.5 Estado “Vencida” (morosidad)

- Al **listar** facturas (admin o residente), el backend ejecuta `_refresh_overdues()`:
  - Facturas en **Pendiente** con `due_date` **menor que ahora (UTC)** pasan a **Vencida**.
- No hay un cron separado solo para mora; se actualiza **al consultar** listados relevantes (`backend/app/routers/invoices.py`).

### 2.6 Generación mensual automática (worker)

- El **worker Celery** incluye **beat** (`worker/Dockerfile`: `worker --beat`).
- Programación definida en `worker/app/celery_app.py`:
  - **Día 1 de cada mes, 05:00 UTC**: tarea `generate_monthly_invoices`.
- Esa tarea crea facturas del **mes actual** para **todas las unidades**, con la misma lógica de monto/vencimiento, e intenta Factus si está habilitado (`worker/app/tasks.py`).

### 2.7 Generación manual (admin)

- Endpoint **`POST /invoices/generate`** con query opcional `period=YYYY-MM`.
- El **seed demo** del admin también llama a la generación para el mes actual tras crear unidades (`backend/app/routers/admin.py`).

---

## 3. Calendario operativo (vista rápida)

Todo en **UTC** salvo que cambies zonas en infraestructura.

| Cuándo | Qué ocurre |
|--------|------------|
| **Cualquier día** | Consultas de listados de facturas pueden marcar Pendiente → **Vencida** si ya pasó `due_date`. |
| **Día 1, 05:00 UTC** | Celery crea facturas del mes en curso para todas las unidades (si no existían). Factus opcional. |
| **Día `INVOICE_DUE_DAY` del mes** (1–28, 23:59:59 UTC) | Vencimiento de las facturas **de ese mismo mes calendario**. |

**Ejemplo** con `INVOICE_DUE_DAY=10`:

- Factura periodo **2026-04** → vence **2026-04-10 23:59:59 UTC**.
- El **2026-04-11** UTC en adelante, al listar, esa factura puede aparecer como **Vencida** si sigue Pendiente.

---

## 4. Demo “en gira” (una página, sin contexto previo)

Objetivo: **levantar**, **entrar** y **mostrar el flujo** en menos de 15 minutos. Copia esta sección al móvil o Notas.

### 4.1 Arranque (una carpeta del proyecto)

```text
cd cobros-residenciales
docker compose up -d --build
```

Espera ~30–60 s y verifica:

- Frontend: **http://localhost:5174** (importante: no uses 5173; Docker mapea 5174→5173)  
- API: http://localhost:8000/health  

### 4.2 Credenciales típicas (después del seed demo)

Si la base ya tiene datos demo:

| Rol | Email | Contraseña |
|-----|-------|------------|
| Admin demo | `admin_demo@conjunto.com` | `Admin12345!` |
| Residente demo | `residente_demo@conjunto.com` | `Residente123!` |

Si la BD está vacía: hay que crear el primer admin con `POST /auth/register` (rol `admin`) y luego `POST /admin/seed-demo` con token de ese admin (el proyecto ya automatizó esto en conversaciones previas).

### 4.3 Guión de demo (orden sugerido)

1. **Login admin** → panel admin.
2. **Unidades**: muestra coeficientes y residentes asignados (seed crea varias).
3. **Facturas**: lista por periodo `YYYY-MM`; explica Pendiente / Vencida / Pagada.
4. **Login residente** (otro navegador o ventana privada) → solo sus facturas de su unidad.
5. **Pago**: iniciar pago desde una factura pendiente y confirmar que pasa a **Pagada** (API interna de `payments`).
6. (Opcional) **Mongo Express**: http://localhost:8081 — inspeccionar colecciones `users`, `units`, `invoices`.

### 4.4 Qué decir en una frase (elevator pitch)

> “Cada mes el sistema genera una cuota por unidad según el coeficiente sobre una base configurable; vence un día fijo del mes; si no se paga, al consultar se marca vencida; el residente solo ve lo de sus apartamentos.”

### 4.5 Parada rápida

```text
docker compose down
```

---

## 5. Referencias en código

| Tema | Ubicación principal |
|------|---------------------|
| Periodo, vencimiento, monto | `backend/app/utils/billing.py` |
| Generación manual + refresco mora | `backend/app/routers/invoices.py` |
| Métricas dashboard | `backend/app/routers/reports.py` |
| Cron mensual + Factus async | `worker/app/celery_app.py`, `worker/app/tasks.py` |
| Variables `.env` | `.env.example` |

---

*Documento generado para alinear equipo y demos; si cambias `invoice_due_day` o el crontab del worker, actualiza la sección 3.*
