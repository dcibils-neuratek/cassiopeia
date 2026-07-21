# Journey vs. Workflow — ejemplo concreto: Apertura de cuenta

Documento de diseño (todavía **no implementado**) para separar el **journey del
cliente** del **workflow**. Bajamos el modelo a un caso puntual —*Apertura de
cuenta*— para verlo bien antes de generalizarlo a los otros productos.

Idea central: el **workflow es la fuente de verdad del estado**; el **journey es
una proyección** (una lente) sobre ese estado, definida por separado. No se
duplica estado: el journey solo *mapea* el nodo activo del flujo a una pantalla.

```
Workflow (ejecución)  ──► capa /apply (traduce) ──► Portal (dibuja)
   fuente de verdad         journey = proyección       tonto
```

---

## 1. El workflow (lo que ya existe hoy)

Flujo `onboarding` ("Apertura de cuenta"), sin cambios:

| nodo | tipo | qué es |
| --- | --- | --- |
| `start` | start | |
| `datos` | userTask (cliente) | formulario `apertura-form` |
| `kyc` | serviceTask | agente IA KYC/AML |
| `gwRisk` | gateway | `decision == 'review'` → revisión, si no → abrir |
| `revision` | userTask (staff, área `cumplimiento`) | `apertura-review` |
| `gwRev` | gateway | `complianceDecision == 'approve'` → abrir, si no → rechazado |
| `abrir` | serviceTask | abre la cuenta (`create-account`) |
| `endOpen` | end | "Cuenta abierta" |
| `endRej` | end | "Rechazado" |

Campos de `apertura-form`: `fullName`, `email`, `document`, `monthlyIncome`, `clientType`.

Fijate que el flujo tiene **9 nodos** y ramas — pero el cliente **no** ve 9 pasos.

---

## 2. El journey (el artefacto nuevo, separado)

Un journey es un artefacto por **producto/token**, aparte del `ProcessDefinition`.
Para apertura de cuenta:

```jsonc
{
  "product": "cuenta",
  "token": "banco-cuenta",
  "defId": "onboarding",
  "title": "Apertura de cuenta",
  "steps": [
    {
      "key": "datos",
      "label": "Tus datos",
      "expect": "Cargá tus datos. Toma 2 minutos.",
      "kind": "form",
      "task": "datos",                 // ← mapea a la userTask del flujo
      "pages": [                        // wizard multi-página DENTRO de este paso
        { "label": "Sobre vos",  "fields": ["fullName", "email", "clientType"] },
        { "label": "Ingresos y documento", "fields": ["document", "monthlyIncome"] }
      ]
    },
    {
      "key": "verificacion",
      "label": "Verificación",
      "expect": "Verificamos tu identidad con IA; si hace falta, un analista revisa tu caso.",
      "kind": "wait",
      "covers": ["kyc", "gwRisk", "revision", "gwRev", "abrir"],  // nodos del flujo que caen acá
      "reviewNodes": ["revision"]       // si la tarea abierta es esta → "En revisión" (no "Analizando")
    },
    {
      "key": "resultado",
      "label": "Resultado",
      "expect": "Te confirmamos si tu cuenta quedó abierta.",
      "kind": "result"
    }
  ]
}
```

**3 pasos de cara al cliente** sobre **9 nodos de flujo**. Ese es el desacople.

Tres tipos de paso:
- `form` → una `userTask` del cliente; puede partirse en `pages` (wizard).
- `wait` → cubre varios nodos internos (servicios, gateways, tareas de staff); el
  cliente ve una pantalla de espera.
- `result` → estado final (mapea a los `end`).

---

## 3. El mapeo: estado del flujo → paso del journey

La capa `/apply` resuelve, en cada consulta, en qué paso está el cliente:

| estado real de la instancia | paso del journey | substate |
| --- | --- | --- |
| tarea abierta = `datos` (cliente) | 1 · Tus datos | `form` |
| corriendo en `kyc` / `gwRisk` / `abrir` / `gwRev` | 2 · Verificación | `analyzing` |
| tarea abierta = `revision` (staff) | 2 · Verificación | `review` |
| completada en `endOpen` | 3 · Resultado | `done` (aprobado) |
| completada en `endRej` | 3 · Resultado | `done` (rechazado) |

Pseudocódigo del resolver (vive en `public-apply.ts`):

```ts
function resolve(journey, def, instance, openTask) {
  if (openTask && isCustomerTask(def, openTask.nodeId)) {
    const i = journey.steps.findIndex(s => s.task === openTask.nodeId);
    return { step: i, substate: "form", form: getForm(openTask.formId) };
  }
  if (instance.status === "completed") {
    const last = journey.steps.length - 1;
    return { step: last, substate: "done", outcome: outcomeOf(def, instance) };
  }
  if (openTask) { // tarea de staff
    const i = journey.steps.findIndex(s => (s.covers||[]).includes(openTask.nodeId));
    return { step: i, substate: "review" };
  }
  const i = journey.steps.findIndex(s => (s.covers||[]).includes(instance.currentNodeId));
  return { step: i, substate: "analyzing" };
}
```

Clave: **el `page` (qué página del form) NO es estado del servidor**. Como el form
es una sola `userTask`, el cliente pagina localmente y **manda todo junto** en un
único submit. El workflow ve una sola entrega. Eso responde el "que al flujo le
llegue todo junto": aplica *dentro* de un paso `form`, no entre pasos.

---

## 4. Contrato de la API (lo que consume el portal)

`GET /apply/:token/intake` → journey + primer paso:

```jsonc
{
  "title": "Apertura de cuenta",
  "steps": [ { "label": "Tus datos", "expect": "…", "kind": "form" },
             { "label": "Verificación", "kind": "wait" },
             { "label": "Resultado", "kind": "result" } ],
  "current": 0,
  "substate": "form",
  "form": { /* apertura-form */ },
  "pages": [ {"label":"Sobre vos","fields":["fullName","email","clientType"]},
             {"label":"Ingresos y documento","fields":["document","monthlyIncome"]} ]
}
```

`GET /apply/:token/:appId` (poll) y las respuestas de `POST …` devuelven lo mismo
más `current`/`substate`/`outcome`/`summary`. El portal siempre pinta a partir de
`steps` + `current` + `substate`.

---

## 5. Cómo lo ve el cliente (portal)

Barra de progreso siempre visible (derivada de `steps`):

```
①  Tus datos   ——  ②  Verificación  ——  ③  Resultado
```

- **Paso 1 (form, 2 páginas)**
  - "Paso 1 de 3 · Tus datos" · "Sobre vos (1/2)": `fullName`, `email`, `clientType`
    → botón **Siguiente** (valida los campos de esta página antes de avanzar).
  - "Ingresos y documento (2/2)": `document`, `monthlyIncome` → **Atrás** / **Enviar**.
  - En **Enviar** recién ahí `POST /apply/:token` con **todos** los campos juntos.
- **Paso 2 (wait)** — la barra avanza a ②.
  - `substate: analyzing` → spinner "Analizando con IA…".
  - `substate: review` → "En revisión — un analista está viendo tu caso" (con poll).
- **Paso 3 (result)** — ③ activo. "🎉 Cuenta abierta" (con `accountId`) o "Rechazado".

---

## 6. Validación antes de pasar de página (el caso que preguntaste)

- **Regla de forma** (obligatorio, patrón, rango, condicional): vive en el
  **formulario** (`required`, `pattern`, `min/max`, `visibleIf`). El portal valida
  los campos de la **página actual** antes de habilitar **Siguiente**. Sin ida y
  vuelta; la regla queda en Cassiopeia (el form). Ej.: `document` con `pattern` de
  DNI; si `clientType == 'empresa'`, un campo CUIT obligatorio por `visibleIf`.
- **Validación contra el backend** ("¿este DNI ya es cliente?"): eso **no** es una
  página — es un **hito real del flujo**. Se modela como `serviceTask` + `gateway`
  en el workflow, y en el journey aparece como otro paso `form`/`wait`. Deja de
  "llegar todo junto" (necesita round-trip), pero queda auditado en el flujo.

---

## 7. Qué NO cambia

- El `ProcessDefinition` no sabe nada del journey (sigue reutilizable: el mismo
  flujo podría tener journeys distintos por canal).
- El estado sigue siendo **uno solo**: la instancia del workflow. El journey es
  solo la lente que la traduce a pantallas.
- Auditoría, Bandeja, Ejecuciones: sin cambios.

---

## 8. Para generalizar después (fuera de este ejemplo)

- Un journey por producto/token (empezar como definición en código/config;
  más adelante, un editor "Portal/Journey" como surface en la app).
- `public-apply.ts`: guardar el journey por token + el `resolve()` de arriba;
  `intake`/`status` devuelven `steps`+`current`+`substate`.
- `banco.ts`: barra de progreso + paginado local del form (submit único).
- Productos y su forma: préstamo e hipoteca = wizard con paso de oferta;
  crédito = wizard con firma; viaje = journey corto (1 form + resultado).

> Decisión pendiente antes de codear: ¿el journey arranca como **config en el
> código** (rápido, por producto) o ya lo modelamos como **artefacto en la DB con
> editor** (más trabajo, pero editable desde la app)? Recomendado: empezar en
> código para este ejemplo, y promoverlo a editor cuando lo validemos.
