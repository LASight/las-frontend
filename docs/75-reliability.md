# Fiabilidad de digitalización — entrega 75%

Cambios solamente en el worktree `las-frontend`, rama
`fix/75-digitization-reliability`. Sin commits/push, cambios científicos,
credenciales, auth, modificaciones del repositorio original ni puertos 5173/8000.

## LOD: solicitudes que sobrevivían a la cancelación del viewport

El efecto anterior descartaba un resultado cuando cambiaba el viewport, mientras
el siguiente efecto omitía la misma tile porque seguía pendiente. Al finalizar
esa solicitud, no se notificaba al efecto vigente ni se programaba un retry.
Además, el efecto de invalidación se ejecutaba después del efecto de fetch y
reemplazaba los mapas a los que acababan de vincularse las solicitudes iniciales.

Ahora cada pirámide tiene identidad por job, layer, origen, dimensiones y
credencial de medios. Cambiar pan/zoom no cancela la propiedad de una solicitud:
las tiles completadas se guardan en esa pirámide y notifican su llegada
individualmente. Los resultados tardíos de otra pirámide no contaminan el job
actual. Los mapas se crean antes del fetch, también bajo StrictMode. Se conserva
el underlay de niveles gruesos y el límite de caché de 48 tiles, sin desalojar
las tiles que el viewport necesita actualmente.

Errores de carga tienen hasta tres intentos por tile, con esperas de 250/500 ms.
Al agotarse dejan de mostrar loading infinito; Crop y Review ofrecen **Retry
tiles** sin cambiar zoom. El loader/auth existente no fue modificado.

## Review → Export: overlay durable

`ReviewEditsStore`, compartido por QueryClient/job, conserva la lista activa a
través del desmontaje de los pasos. `useCurveReview` sigue aplicando el replay
sobre copias: nunca modifica los arrays del modelo. Redraw/discard/accept
agregan operaciones; undo elimina la última; reset guarda una lista vacía.

Cada cambio inicia guardado automático. Los PUT de reemplazo de lista se
serializan: una respuesta antigua no puede sobrescribir un stroke, undo o reset
posterior. Los borradores pendientes se escriben sincrónicamente en localStorage,
con base URL/job y revisión de base, y se eliminan al confirmar el guardado.
En una recarga se recuperan del backend las ediciones confirmadas; un borrador
no confirmado se recupera localmente y reintenta con su revisión original.
Storage privado/no disponible no impide guardar en backend, pero no garantiza
recuperación de un borrador si se cierra la página antes de confirmar.

Review muestra guardado/error y ofrece retry. Un 409 conserva el borrador y no
hace un overwrite automático. **Restore saved corrections**, con confirmación
explícita, descarta el borrador y consulta el job actual; sirve para resolver
conflictos o un PUT cuyo resultado se perdió en la red. No hay merge automático
entre pestañas. Se aceptan revisiones superiores del job para invalidaciones
upstream cuando no hay un borrador pendiente; respuestas antiguas se ignoran.

Download LAS y Analyze esperan todos los guardados pendientes antes de llamar al
backend. Ambos envían la misma lista confirmada y su revisión. Un fallo al guardar
bloquea esa exportación, en lugar de mandar `[]` silenciosamente. Un reset sí
envía `[]` explícitamente, con la nueva revisión confirmada.

## Contrato backend utilizado

Verificado leyendo los cambios del agente backend en su worktree; ningún archivo
backend fue editado por este agente.

- `GET /api/digitization/jobs/{id}`: `edits: CurveEdit[]`,
  `edits_revision: number`, además de los campos existentes.
- `PUT /api/digitization/jobs/{id}/edits`:
  `{ edits: CurveEdit[], edits_revision?: number }`; responde **JobSummary**.
  La revisión es la esperada antes del PUT, no un número inventado por el cliente.
- `/export-las` y `/send-to-analysis`: request existente más
  `edits_revision`; frontend manda la lista confirmada explícitamente.
- Conflicto de revisión: 409. La lista activa puede reducirse para undo/reset;
  el audit append-only y los snapshots durables corresponden al backend.

Los campos de JobSummary son opcionales en TypeScript por compatibilidad con
fixtures/servidores anteriores. Un servidor sin PUT de edits no puede confirmar
nuevas correcciones: se muestra error y no se exporta un resultado vacío como
si las correcciones hubieran sido guardadas. El gateway mock solamente se adaptó
al nuevo método/interfaz; no se utilizó como evidencia funcional ni científica.

## Verificaciones ejecutadas

Instalación aislada: `npm ci` en `las-frontend/frontend`.

- **182 tests, 15 suites, todos PASS** (Vitest 2.1.9 / jsdom).
- **`npm run build` PASS** (TypeScript y Vite).
- **`git diff --check` PASS**.
- Build conserva el aviso preexistente de chunks grandes. `npm ci` reportó
  20 vulnerabilidades de dependencias (1 low, 7 moderate, 8 high, 4 critical);
  no se cambiaron dependencias ni lockfile para resolverlas en este alcance.
- `frontend/tsconfig.tsbuildinfo` se regeneró al compilar.

Regresiones nuevas:

- Hook LOD: pan ida/vuelta con requests aún pendientes, deduplicación,
  StrictMode, resultados tardíos de otro job, retry limitado y retry manual.
- Store: guardados secuenciales con strokes/undo/reset pendientes, recuperación
  de borrador y revisión después de fallo, inmutabilidad del modelo, replay
  backend, rechazo de job antiguo e invalidación nueva, recuperación explícita
  de conflicto.
- Hook + ExportStep real en React/jsdom: navegación/desmontaje Review→Export,
  payload de Download y Analyze, nuevo QueryClient simulando recarga con job
  backend, undo/reset, espera de PUT pendiente y bloqueo ante fallo de guardado.
- Gateway: nombres/path/método/body de PUT y revisión del reset en export.

### Runner y ruta con `%`

El primer `npm test -- --run` falló antes de recoger **todas** las suites por
`URIError: URI malformed`, debido al `%` literal de `4. Entrega 75%` y el Vite
incluido en Vitest 2. Se resolvió sin copiar ni modificar el repo original: alias
symlink sin `%` y `resolve.preserveSymlinks: true` en `vite.config.ts`.

Alias creado en esta ejecución:

```text
/private/var/folders/8d/gbzdh3717kxcbbbb00mlqqzr0000gn/T/opencode/wellsight-frontend-reliability
→ worktree las-frontend/frontend
```

Desde `las-frontend/frontend`, comando que pasó:

```sh
npm test -- --run --root /private/var/folders/8d/gbzdh3717kxcbbbb00mlqqzr0000gn/T/opencode/wellsight-frontend-reliability
```

## Pendiente: navegador real, coordinado por agente principal

Estas pruebas usan dobles de red únicamente para regresión unitaria/integración
React; **no sustituyen evidencia de browser/backend real**. No se inició servidor
en este agente porque el principal coordina el backend/puertos de la validación.
Ejemplo de arranque aislado, cambiando el backend por el puerto real autorizado:

```sh
VITE_API_BASE_URL=http://127.0.0.1:8011 VITE_AUTH_MOCK=false VITE_DIGITIZATION_MOCK=false npm run dev -- /private/var/folders/8d/gbzdh3717kxcbbbb00mlqqzr0000gn/T/opencode/wellsight-frontend-reliability --host 127.0.0.1 --port 5188 --strictPort
```

Revisar en browser real: carga inicial Crop/Review sin workaround, pan/zoom rápido
con throttling, Retry tiles, redraw+discard, Review→Export→Review, recarga en
ambos pasos, comparación de LAS antes/después, Analyze, undo/reset durables,
caída/reinicio backend y conflicto entre dos pestañas. Verificar CORS para el
puerto nuevo y recuperación de GET job después de reinicio. La durabilidad de
artefactos/audit del backend no está demostrada por los tests de frontend.

Límites: no merge entre pestañas; si storage está bloqueado y el backend no
confirmó, cerrar la página pierde el borrador; un loader de imagen/red que nunca
resuelva/rechace no recibe timeout nuevo en este cambio. La revisión protege
contra sobrescrituras externas pero no convierte una sesión offline en durable
sin backend. La CLI Orca de coordinación falló con
`Unable to determine Orca.app path from symlink: /usr/local/bin/orca`; se informa
el contrato al principal mediante esta nota y el resultado final.
