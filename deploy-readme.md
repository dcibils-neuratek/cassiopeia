# Cassiopeia — guía de despliegue

Cómo poner Cassiopeia en un servidor de producción. Cubre arquitectura, build,
variables de entorno, **dónde va cada clave (Claude, Mandrill, integraciones)**,
reverse proxy, arranque como servicio, backups y actualización.

> ⚠️ **Seguridad:** este archivo NO contiene claves reales — sólo dice qué clave
> va dónde. Nunca commitees claves. Las keys de Claude/Mandrill/integraciones se
> cargan desde la interfaz y quedan **cifradas** en la base; la única clave que
> vive como variable de entorno es la clave maestra que las cifra.

---

## 1. Arquitectura

Dos piezas y un proxy adelante:

```
Internet ──HTTPS──▶  Reverse proxy (Caddy / nginx)
                       │
                       ├─ sirve  apps/web/dist/   (front estático, SPA)
                       └─ redirige a la API:
                            /api        → API (le quita el prefijo /api)
                            /banco      → API   (portal del cliente)
                            /apply      → API   (envío de formularios del portal)
                            /hooks      → API   (webhooks entrantes)
                            /callbacks  → API   (callbacks async de conectores)
                                          │
                                          ▼
                            API Node (Fastify) en :3001
                                          │
                                          ▼
                            apps/api/data/   (SQLite + secret.key + archivos)
```

- **Front:** estático. `vite build` genera `apps/web/dist/`. No requiere Node en runtime.
- **API:** proceso Node (Fastify) corrido con `tsx` (no hay paso de compilación). Base de datos **SQLite embebida** (`node:sqlite`) — no hay DB externa que instalar.
- **Proxy:** hace de pegamento, igual que el proxy de Vite en desarrollo.

---

## 2. Requisitos del servidor

| Componente | Versión | Notas |
|---|---|---|
| Node.js | **≥ 22** | Obligatorio: usa `node:sqlite` (incluido en Node 22+). Recomendado 22 LTS o 24. |
| pnpm | ≥ 10 | `corepack enable && corepack prepare pnpm@latest --activate` |
| Reverse proxy | Caddy o nginx | Caddy es el más simple (TLS automático). |
| SO | Linux | systemd para correr la API como servicio. |

---

## 3. Instalación y build

```bash
git clone https://github.com/dcibils-neuratek/cassiopeia.git /opt/cassiopeia
cd /opt/cassiopeia

pnpm install                              # instala dependencias (aprueba esbuild)
pnpm --filter @cassiopeia/web build       # genera apps/web/dist/  (el front)
```

La API no necesita build: corre TypeScript directo con `tsx`.

---

## 4. Variables de entorno

Sólo la API usa variables de entorno. Guardalas en `/etc/cassiopeia.env`
(permisos `600`, dueño el usuario del servicio):

```ini
# /etc/cassiopeia.env
NODE_ENV=production

# Puerto de la API (el proxy apunta acá). Default 3001.
PORT=3001

# 🔑 CLAVE MAESTRA — cifra TODAS las claves guardadas (Claude, Mandrill, integraciones).
# Generala una vez con:  openssl rand -hex 32
# Debe ser ESTABLE y estar respaldada. Si la perdés, los secretos guardados
# quedan irrecuperables y hay que recargarlos.
CASSIOPEIA_SECRET_KEY=<64_caracteres_hex_aqui>
```

> Si NO seteás `CASSIOPEIA_SECRET_KEY`, la app genera una sola vez el archivo
> `apps/api/data/secret.key`. Funciona, pero en producción es preferible la
> variable de entorno (y respaldar igual el directorio `data/`).

---

## 5. 🔑 Claves y dónde va cada una

Esta es la parte importante. Hay **una sola clave por variable de entorno** (la
maestra); **todo el resto se carga desde la interfaz** y se guarda cifrado en la
base con esa clave maestra.

| Clave / secreto | Para qué sirve | Dónde se configura | Valor de ejemplo |
|---|---|---|---|
| **`CASSIOPEIA_SECRET_KEY`** | Cifra todas las demás claves en la base | Variable de entorno (`/etc/cassiopeia.env`) | 64 hex (`openssl rand -hex 32`) |
| **Clave de Claude** (modelo de plataforma) | Potencia *Describir* y *Construir con IA* | **Ajustes → Modelo de IA → Clave de API** | Anthropic API key (`sk-ant-…`) |
| **Clave de Mandrill / correo** | Recordatorios por email (solicitudes sin completar) | **Ajustes → Correo → Clave de API** | Mandrill/Resend API key |
| **Claves de integraciones** | Cada agente/API/MCP que use un flujo | **Integraciones →** (cada integración su clave/URL) | según el proveedor |

### 5.1 Claude (modelo de plataforma) — Ajustes → Modelo de IA

- **Modelo:** por defecto `claude-haiku-4-5-20251001` (hay atajos para Haiku / Sonnet / Opus).
- **URL base:** `https://api.anthropic.com/v1` (endpoint compatible con OpenAI).
- **Clave de API:** tu clave de Anthropic. Se guarda cifrada; si dejás el campo en blanco al reeditar, **se conserva** la anterior.
- Sirve para: el botón *✦ Describir*, *Construir con IA* (plan/commit) y cualquier explicación generada por la plataforma.
- Podés usar **cualquier proveedor compatible con OpenAI** cambiando URL base + modelo + clave.

### 5.2 Correo saliente (Mandrill) — Ajustes → Correo

- **Proveedor:** `mandrill`, `resend` o `http` (servicio propio).
- **Remitente (From):** ej. `Banco del Futuro <noreply@tudominio.com>`.
- **Clave de API:** la de Mandrill (o Resend).
- **URL del portal:** ej. `https://tudominio.com` — **importante**, con esto se
  arman los links de reanudación de los recordatorios. Si lo dejás vacío, se usa
  el host del request (puede salir mal detrás de un proxy). **Seteá tu dominio acá.**
- Requerido para: recordatorios de *Sin completar* y las Automatizaciones.

### 5.3 Integraciones — página Integraciones

Cada integración (API / Agente de IA / MCP / Maverick) tiene su propia
configuración (URL, clave/token, etc.), se guarda cifrada, y sólo aparece en el
diseñador de flujos cuando está **Publicada**. Cargá las claves acá después del deploy.

---

## 6. Arranque de la API como servicio (systemd)

```ini
# /etc/systemd/system/cassiopeia.service
[Unit]
Description=Cassiopeia API
After=network.target

[Service]
Type=simple
User=cassiopeia
WorkingDirectory=/opt/cassiopeia
EnvironmentFile=/etc/cassiopeia.env
# Usá la ruta real de pnpm:  which pnpm   (o  corepack pnpm)
ExecStart=/usr/local/bin/pnpm --filter @cassiopeia/api start
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cassiopeia
sudo systemctl status cassiopeia
journalctl -u cassiopeia -f          # logs
```

> El proceso corre con working dir `apps/api`, así que `data/` se crea en
> `/opt/cassiopeia/apps/api/data/` sin importar desde dónde se lance.

---

## 7. Reverse proxy

### Opción A — Caddy (recomendado, TLS automático)

```caddy
# /etc/caddy/Caddyfile
tudominio.com {
    encode gzip

    # API: quita el prefijo /api (igual que el proxy de Vite)
    handle_path /api/* {
        reverse_proxy localhost:3001
    }

    # Portal del cliente y endpoints públicos (SIN quitar prefijo)
    @publicos path /banco* /apply* /hooks* /callbacks*
    handle @publicos {
        reverse_proxy localhost:3001
    }

    # Front estático (SPA) con fallback a index.html
    handle {
        root * /opt/cassiopeia/apps/web/dist
        try_files {path} /index.html
        file_server
    }
}
```

```bash
sudo systemctl reload caddy
```

### Opción B — nginx

```nginx
server {
    listen 443 ssl;
    server_name tudominio.com;
    # ssl_certificate ... (ej. certbot)

    root /opt/cassiopeia/apps/web/dist;

    # API: /api/... → API sin el prefijo /api
    location /api/ {
        proxy_pass http://127.0.0.1:3001/;   # la barra final quita /api
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Endpoints públicos (sin reescribir)
    location ~ ^/(banco|apply|hooks|callbacks) {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA: todo lo demás al index.html
    location / {
        try_files $uri /index.html;
    }
}
```

---

## 8. Primer arranque — checklist post-deploy

Con la API corriendo y el proxy sirviendo `tudominio.com`:

1. **Entrá** a `https://tudominio.com` y logueate con el admin por defecto: **`admin` / `admin`**.
2. **Cambiá la contraseña del admin** de inmediato (Ajustes → Usuarios y acceso → *Clave*).
3. **Cargá la clave de Claude** en Ajustes → Modelo de IA (así funciona *Describir* / *Construir con IA*).
4. *(Opcional)* **Configurá el Correo** (Ajustes → Correo): proveedor, remitente, clave y **URL del portal** = `https://tudominio.com`.
5. *(Opcional)* **Activá Automatizaciones** (recordatorios de solicitudes sin completar).
6. **Cargá las claves de las Integraciones** que usen tus flujos y **publicalas**.
7. Creá los usuarios reales (operadores, analistas) y sus áreas.

---

## 9. Datos y backups

Todo el estado vive en un único directorio: **`/opt/cassiopeia/apps/api/data/`**

| Archivo | Qué es |
|---|---|
| `cassiopeia.sqlite` (+ `-wal`, `-shm`) | La base entera: flujos, formularios, integraciones, usuarios, instancias, auditoría. Corre en modo WAL, así que los tres archivos son parte de la base. |
| `secret.key` | Clave maestra (sólo si NO usás `CASSIOPEIA_SECRET_KEY`). |
| archivos subidos | Adjuntos cargados en formularios. |

- **Respaldá este directorio periódicamente** (y `/etc/cassiopeia.env` si usás la env var).
- Backup consistente: `systemctl stop cassiopeia && tar czf backup.tgz apps/api/data && systemctl start cassiopeia`. Para backup en caliente usá `sqlite3 apps/api/data/cassiopeia.sqlite ".backup backup.sqlite"` (no copies sólo el `.sqlite` suelto: en modo WAL quedaría inconsistente).
- Está gitignoreado — nunca se sube al repo.

---

## 10. Actualizar a una versión nueva

```bash
cd /opt/cassiopeia
git pull
pnpm install
pnpm --filter @cassiopeia/web build
sudo systemctl restart cassiopeia
```

Las migraciones de esquema son **aditivas e idempotentes** — la base existente se
actualiza sola al arrancar, sin perder datos.

---

## 11. Notas

- **CORS:** la API refleja el origen (`origin: true`). Detrás del proxy same-origin
  no hace falta tocar nada; si en el futuro servís el front desde otro dominio,
  conviene restringirlo.
- **Tamaño de subida:** el límite de body es 20 MB (adjuntos en base64).
- **Escala:** hoy es un solo proceso con SQLite (suficiente para un piloto/banco
  mediano). El SQL se mantiene vanilla para migrar a Postgres vía Drizzle más adelante.
```
