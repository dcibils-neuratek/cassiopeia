# Seguir trabajando en Cassiopeia desde otra máquina

Guía corta para retomar este proyecto (y su trabajo con Claude Code) en otra
computadora. Todo el **código** está en el repo; lo único local de cada máquina
es la base de datos y las API keys.

Repo: `https://github.com/dcibils-neuratek/cassiopeia.git`

---

## ✅ Forma recomendada (limpia, sin secretos)

No hace falta el historial del chat: `CLAUDE.md` le da a Claude Code todo el
contexto del proyecto automáticamente.

```bash
git clone https://github.com/dcibils-neuratek/cassiopeia.git
cd cassiopeia
pnpm install
pnpm start        # levanta API (:3001) + web (:5173) juntos → http://localhost:5173
claude            # abre Claude Code; CLAUDE.md se carga solo
```

Otros comandos útiles: `pnpm dev:api`, `pnpm dev:web`, `pnpm typecheck`, `pnpm test`.

---

## Puesta a punto en la máquina nueva

1. **La base de datos es local** (`apps/api/data/`, está gitignored) → arranca
   vacía. Los **5 flujos del Banco del Futuro se re-siembran solos** en el primer
   arranque de la API, junto con sus formularios, agentes, tokens públicos y los
   usuarios de staff.

2. **Los agentes de IA arrancan sin API key.** Entrá a la app →
   **Ajustes → Modelo de IA de la plataforma**, pegá tu API key de Claude una vez
   y guardá. Los agentes (`credit-agent`, `kyc-agent`, `mortgage-agent`,
   `fraud-agent`) **heredan esa key** en el siguiente arranque. Con eso funciona
   toda la demo.

3. **Portal del cliente:** `http://localhost:3001/banco` (o desde el atajo en
   **Inicio** de la app). Es un sitio público con los 5 productos.

### Usuarios de la demo

| Usuario | Contraseña | Rol / Área | Ve en la Bandeja |
| --- | --- | --- | --- |
| `admin` | `admin` | admin | todo |
| `officer` | `officer` | operator · **creditos** | revisiones de crédito |
| `cumplimiento` | `cumplimiento` | operator · **cumplimiento** | revisiones KYC/AML |

> Cambiá estas contraseñas si esto deja de ser una demo local.

---

## ⚠️ Importante: NO subir el transcript del chat al repo

Claude Code guarda el historial de la conversación en `~/.claude/…` (local a cada
máquina). Ese transcript **contiene la API key en texto plano** (se pegó en el
chat). Por eso:

- **No corras `scripts/save-session.mjs` para actualizar `.session/` y pushear**
  si el repo puede ser público — eso subiría la key a GitHub.
- Conviene **rotar esa API key** de todas formas (ya circuló en texto plano).

### Si querés el historial exacto del chat (opcional)

Solo sirve para hacer `claude --resume` y ver el scrollback de esta conversación.
Como el transcript trae la key, **transferilo a mano** (scp / USB), nunca por el
repo público:

```bash
# en la máquina nueva, tras clonar y copiar el .jsonl a mano:
# destino: ~/.claude/projects/-Users-<user>-Code-Cassiopeia/<session-id>.jsonl
claude --resume   # elegí la sesión de Cassiopeia
```

En la práctica **no lo necesitás**: arrancá con `claude` a secas. No perdés el
trabajo (está todo en el código y en `CLAUDE.md`), solo el scrollback del chat.

---

## Convenciones del proyecto

- Commit + push a `origin/main` después de cada cambio (historia lineal simple).
- Nunca commitear `node_modules/`, `apps/api/data/` ni `*.sqlite` (gitignored).
- Verificar los cambios de UI en el navegador antes de commitear.

Más detalle del producto y la arquitectura: ver `CLAUDE.md`.
