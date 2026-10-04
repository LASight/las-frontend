# Frontend — una curva, varios segmentos (75%)

Alcance exclusivo: worktree `wellsight-75-segments/las-frontend`, rama
`feat/75-multi-segment`. Sin commits/push, sin cambios backend/ORION/modelos ni en
los repositorios originales o el worktree de fiabilidad. Se conservan los cambios
heredados de LOD y overlay durable de `docs/75-reliability.md`.

Contrato obligatorio: `../PFI/outputs/75-multi-segment/CONTRACT.md`. No se modificó.

## Flujo implementado

- Panel **Segments of one curve** en todos los pasos del wizard: crear colección
  con el job actual como primer miembro y un título ingresado manualmente; añadir
  una continuación mediante el backend desde el raster original; seleccionar el
  job independiente de cada segmento y volver al resumen desde cualquier job,
  incluido el que se abre desde My Files. No hace falta copiar identificadores.
- Ruta `/digitize/collections/:collectionId` declarada **antes** de la ruta
  dinámica de jobs y fuera de los guards de fase del wizard.
- Resumen con fases e intervalos, enlaces al wizard normal, rename/detach de
  miembros (detach conserva el job guardado y no permite quitar el último).
- Readiness: todos los jobs con crop/calibración/curva listos, mismo mnemónico y
  unidades de valor/profundidad; se muestran además los `issues` del backend.
  Escalas espaciales y rangos pueden diferir. No se renombran curvas ni convierten
  unidades automáticamente.
- Selector obligatorio para **cada** `conflict_id`: el operador elige un
  `job_id` válido. No existe promedio, prioridad automática ni selección default.
  Ambos botones de salida permanecen deshabilitados mientras falte una decisión,
  haya issues, un refetch pendiente/error o un step inválido.
- Header opcional inicialmente vacío, independiente del título de la colección;
  step en unidades comunes; descarga LAS/preview y handoff a
  `/analysis?analysis=<analysis_id>` con invalidación del historial.

## Revisiones, borradores y aislamiento

`CollectionSummary.revision` es un **fingerprint string**, distinto de la revisión
numérica de edits de un job. Ambos outputs envían
`{header, step, overlap_choices, expected_revision}`; no envían edits globales.

Los borradores de solapes se guardan en localStorage por API/collection ID. Se
validan por conflict ID, rango y conjunto de candidatos. Un cambio de fingerprint
sin cambios del conflicto **conserva** las elecciones relevantes; un conflicto
nuevo/modificado exige una decisión nueva; desaparecidos/ilegales se eliminan.
La validación también ocurre durante render para bloquear opciones obsoletas
antes del efecto de persistencia. Storage corrupto/no disponible no inventa
decisiones y muestra aviso si no puede persistir.

Antes de exportar/analizar se esperan los guardados durables de **cada job**,
incluidos borradores recuperados, y se consulta una colección fresca. Si cambió
la revisión, se actualiza el resumen y se pide revisar/volver a exportar: no hay
retry automático. Un 409 del output muestra el error y refresca la colección,
sin elegir por el usuario. Un fallo de guardado conserva el borrador y bloquea
el output. El operador puede resolverlo en Review del job correspondiente.

El store de overlays, los caches de curvas/tiles y los requests de edits siguen
indexados por job ID. El Outlet del wizard se remonta al cambiar de job para no
reutilizar estado local de crop/calibración/herramientas entre segmentos. No hay
selección global de segmento en el servidor ni copias de strokes entre jobs.

## Límites honestos de UI

- Se usa el detector/layout existente únicamente para proponer recortes. El
  operador confirma recorte y profundidad manualmente. La UI no promete detectar
  todas las continuaciones, leer profundidades por OCR ni demostrar continuidad.
- No se agregó OCR de toda la imagen ni soporte nuevo de TIFF multipágina. Cada
  segmento procede del mismo raster original manejado por la API existente.
- La UI informa que huecos entre segmentos y valores faltantes permanecen NULL,
  sin interpolar separaciones de páginas. La unión LAS, sus metadatos, la
  preservación de NULL/model output y los límites definitivos los implementa y
  valida el backend; el frontend no genera una curva combinada.
- Límite preventivo frontend: 1.000.000 filas estimadas, incluyendo gaps, y step
  positivo/finito. Superar los chequeos frontend no garantiza aceptación del
  backend, que puede imponer límites más restrictivos.
- Colecciones no disponibles en modo mock. El nuevo gateway habla exclusivamente
  con la API real. Los fixtures y mocks de tests **no son evidencia científica
  ni de integración real**; no se extendió el generador sintético de curvas.
- No merge automático de decisiones entre pestañas. Header/step no se persisten
  como borrador; solamente las decisiones de solape.

## Verificación y comandos aislados

Instalación: `npm ci` dentro de **este** `las-frontend/frontend`, con node_modules
propio. Sin modificar dependencias/lockfile. Reportó las mismas 20 vulnerabilidades
(1 low, 7 moderate, 8 high, 4 critical); remediación fuera de este alcance.

El `%` literal del checkout provoca `URI malformed` en Vitest 2 si se usa la raíz
real. Se creó un alias nuevo, no el del worktree anterior; se conserva
`resolve.preserveSymlinks` heredado. Desde la raíz de este worktree:

```sh
ALIAS='/private/var/folders/8d/gbzdh3717kxcbbbb00mlqqzr0000gn/T/opencode/wellsight-segments-frontend'
# Crear solo si no existe; no reemplazar aliases ajenos:
ln -s "$PWD/frontend" "$ALIAS"
cd "$ALIAS"
VITE_API_BASE_URL='http://127.0.0.1:8002' npm test -- --run --root "$ALIAS"
VITE_API_BASE_URL='http://127.0.0.1:8002' npm run build
```

Vitest requiere `--root` explícito porque npm puede resolver el cwd físico del
symlink. Vite **build** no admite `--root`; no pasar esa opción al script build.
Las pruebas heredadas de auth ahora toman `API_BASE` del cliente, en vez de
fijar `8000`; se conservan sus ocho casos y comprobaciones de refresh/retry.

Resultado de la suite final: **230 tests / 20 suites PASS**, incluyendo los
**182 tests heredados** y 48 casos nuevos. TypeScript/Vite build **PASS** con
`VITE_API_BASE_URL='http://127.0.0.1:8002'`; `git diff --check` **PASS**. Se
conserva el warning preexistente de chunks grandes y se regenera
`frontend/tsconfig.tsbuildinfo` al compilar.

Cobertura nueva: contrato HTTP completo de colecciones; elecciones explícitas
por conflict ID (dos/tres candidatos), validación de borradores y conservación
selectiva; incompatibilidades/step/límites; React/jsdom create/add/select/return;
descarga y handoff; conflictos de revisión sin retry silencioso; recuperación y
fallo de guardados por job; navegación de segmentos sin fuga de strokes o caches;
ubicación de la ruta fuera de guards de jobs.

## Integración real pendiente del QA principal

**No se iniciaron servidores ni se utilizó el backend real como evidencia.**
Pendiente: ciclo autenticado con dos/tres segmentos reales, reinicio/persistencia,
recortes independientes, NULL/gaps en el LAS descargado y análisis conjunto.
Entorno indicado por contrato: API `8002`, UI candidata `5175`, PostgreSQL aislado
`55434`, a cargo del QA principal. No tocar `8000/5173` ni `8001/5174`.

Comando candidato de UI, **documentado pero NO ejecutado**, solo cuando el QA
principal confirme el backend y puerto libres:

```sh
VITE_DIGITIZATION_MOCK='false' VITE_API_BASE_URL='http://127.0.0.1:8002' npm run dev -- "$ALIAS" --host '127.0.0.1' --port '5175' --strictPort
```

No usar `npm run dev` sin puerto explícito: el default heredado es `5173`.

## Corrección encontrada en la primera integración real

El intento `evidence-attempt-01` mostró dos paneles al cambiar de job y mezcló la
vista previa de un tramo con la continuación. `SegmentsPanel` y `Outlet` tenían
el mismo `key` (job ID) como hermanos. React no puede reconciliar dos hermanos
con la misma identidad; la navegación dejó un panel obsoleto en el DOM.

Se utilizan ahora identidades prefijadas distintas (`segment-panel:` y
`segment-step:`), manteniendo el remount del paso por job. Se agregó una prueba
con `createMemoryRouter`, el workspace real y dos jobs: navegación ida/vuelta,
un solo panel y un solo paso con el job correcto, sin avisos de claves duplicadas.
El subagente no pudo continuar por límite de uso; la coordinación aplicó esta
corrección y repitió la regresión. La aceptación real posterior se informa en el
HTML principal, no se presume aprobada por esta prueba jsdom.

## Análisis guardado: referencia durable de UI

La integración 03 confirmó que el LAS conjunto se analizaba y guardaba, pero
recargar perdía el run seleccionado: el workspace borraba el query param y
navegaba sin ID. Ahora conserva `?analysis=<id>` al adoptar y seleccionar un run;
las pestañas conservan esa query. El guard de adopción evita solicitudes repetidas
por render, manteniendo la rehidratación al recargar una página nueva. Una prueba
con router y hook simulado verifica URL/adopción/cambio/remount/tab links; la
aceptación real con backend está documentada por separado en el HTML principal.

## Corte final de la coordinación

**233 tests / 23 suites PASS**, 182 heredados y 51 nuevos, build PASS.
`evidence-attempt-05` completó el flujo real: tres inferencias, propuestas layout
opcionales mediante Detect track regions en ambos jobs de continuación, unión,
edición aislada, reinicio y análisis conservado al recargar. No se afirma que
las propuestas identifiquen continuidad ni que sean saltos reales: el caso usa
subdivisiones controladas del intervalo RHONDA congelado.
