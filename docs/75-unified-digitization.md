# Digitalización unificada: un documento, una curva, una salida

## Alcance y navegación

Implementación frontend en `feat/75-unified-digitization`, exclusivamente en
`.worktrees/wellsight-75-unified/las-frontend`. Sin cambios de backend, ORION,
modelos, migraciones ni nuevos endpoints. Sin commits/push.

- Upload → job fuente → colección API interna con título igual al nombre del
  archivo → primer miembro `Tramo 1` → `/digitize/curves/:collectionId`.
- El header muestra archivo/mnemónico, no IDs ni jerga de colecciones. Rail de
  tramos compacto, canvas original/revisión y un inspector. Herramientas locales:
  Recortar, Calibrar, Revisar, Resultado; selección y vista sobreviven enlaces
  fríos mediante `?segment=…&view=crop|cal|review|result`.
- `/digitize/collections/:collectionId` redirige al Resultado unificado.
  Cualquier URL del wizard de un miembro redirige a la curva con ese miembro
  seleccionado. El ExportStep también protege directamente los miembros: sólo
  ofrece abrir la salida conjunta, nunca descarga/análisis individual.
- My Files abre el job de raster para resolver su pertenencia y llegar a la
  curva. El vínculo separado Open analysis conserva acceso a análisis anteriores.
  Los jobs independientes guardados siguen usando su wizard y salida anteriores.
- Si falla crear la colección, reintentar no vuelve a subir el TIFF. La pertenencia
  durable del job recupera una respuesta de creación perdida.

## Trabajo sobre el escaneo

TrackCropper conserva tiles LOD, pan/zoom, selección con mouse/teclado y retry de
tiles. El rectángulo activo siempre se ve en Recortar/Calibrar; los recortes
confirmados de otros tramos se dibujan con borde discontinuo y su etiqueta.
Layout muestra propuestas seleccionables **manualmente**: no se adopta una
propuesta automática, ni se afirma que identifica todas las continuaciones o
lee profundidad. Límites precisos px están en un details del inspector.

Cada tramo tiene borrador propio de recorte/calibración en memoria y localStorage,
separado por API y job. Escribir o cambiar de tramo no llama al backend. Guardar
es una acción explícita; borradores pendientes bloquean Procesar curva. Descartar
borrador conserva las predicciones/correcciones del servidor. Datos físicos nuevos
comienzan vacíos: no se inventan profundidades, unidades, mnemónico ni pozo.

Escalas y profundidad son independientes. Mnemónico y unidades de valor/profundidad
deben coincidir entre miembros; no hay conversiones o reemplazos silenciosos.
Copiar escala exige seleccionar el origen y confirmar: copia sólo escala,
límites horizontales, mnemónico y unidad de curva **al borrador**; no profundidades
ni unidad de profundidad, y no guarda automáticamente.

El lápiz del inspector renombra un tramo mediante renameSegment. No recorta,
calibra, procesa ni invalida predicciones/ediciones. Permite distinguir pasadas
como MAIN / REPEAT. Esas etiquetas y rangos se ingresan a partir de la fuente:
la UI no trata pasadas solapadas como páginas consecutivas ni incorpora valores
físicos de Shutts al código.

## Procesar y revisar

Procesar curva usa una cola frontend **secuencial** de miembros con recorte y
calibración guardados, sin predicción. Consulta estado fresco antes de cada
inicio, conserva READY y sus correcciones y reutiliza los settings guardados o
el DEFAULT_SEGMENTATION existente. Reingresa primero en tareas ya en ejecución;
polling por job cada 1200 ms publica progreso real en el rail. La colección también
usa polling mientras hay procesamiento.

Un fallo de inferencia/red detiene la cola y muestra error/reintento, sin declarar
el tramo aprobado ni iniciar los posteriores silenciosamente. Cerrar el workspace
detiene sólo la coordinación frontend, no la inferencia ya enviada; al reabrir,
Seguir procesamiento/Procesar curva retoma pendientes explícitamente. No existe
un endpoint nuevo de cola durable ni procesamiento paralelo de miembros.

Revisión usa RasterViewport + useCurveReview y el store existente por job, con
autosave serializado de correcciones y edits_revision. Strokes, undo/reset,
curvas, tiles y drafts no se comparten entre miembros. Los keys de hermanos se
prefijan (`rail:`, `editor:`, `review:`, `plot:`, etc.) para evitar ghost DOM.

Cambiar datos de un READY exige advertencia y confirmación antes de guardar,
además de esperar el guardado durable de correcciones. **Detalle del backend
auditado:** setCrop resetea arrays/calibración/ediciones; setCalibration solo cambia
la escala. Por eso modificar calibración de un READY llama primero a setCrop
con su mismo recorte (reset explícitamente confirmado), y luego a setCalibration.
Si falla el segundo paso, queda visible el estado reseteado/no listo y el borrador
permite reintentar. Nunca se reprocesa automáticamente. Esta secuencia no es una
transacción nueva y no elimina datos de los otros miembros.

## Una salida

Resultado reúne rangos, huecos y solapes. Cada solape requiere una selección
manual sin defaults, promedios o prioridad automática. El borrador está ligado
a firmas de intervalos/candidatos y colección/API; cambios de conflicto invalidan
sólo sus decisiones. Huecos quedan NULL.

El gráfico SVG presenta los tramos corregidos en profundidad mediante las
conversiones de visualización existentes. Rompe la línea en NULL y muestra ambos
tramos en solapes; **no es un LAS resampleado** ni reemplaza las decisiones de
solape del backend. Se limita la densidad visual, no se interpola, ni se calcula
la exportación/ML en el cliente.

Descargar LAS y **Analizar curva** son las únicas salidas para miembros. Ambas
esperan flush de ediciones de todos los miembros, obtienen revisión fresca y
envían fingerprint + decisiones al API conjunto existente. Una revisión cambiada
o 409 exige revisar/reintentar; nunca se exporta una decisión vieja silenciosamente.
Paso inválido/tamaño >1.000.000 filas, unidades incompatibles y miembros no listos
bloquean salida; el backend conserva sus comprobaciones definitivas. Cabecera LAS
opcional empieza vacía, y cabecera/paso/decisiones se conservan como drafts locales.
Analizar navega al analysis_id devuelto y conserva los fixes heredados de apertura,
persistencia y regreso desde análisis.

## QA: selectores estables

| Acción | Selector / texto |
|---|---|
| Workspace | `/digitize/curves/:collectionId?segment=:jobId&view=crop` |
| Añadir tramo | `#add-curve-segment` / `+ Añadir tramo` |
| Seleccionar miembro | `#select-segment-:jobId` |
| Cambiar herramienta | `#curve-view-crop`, `#curve-view-cal`, `#curve-view-review`, `#curve-view-result` |
| Px (expandir details) | `#crop-x-left`, `#crop-x-right`, `#crop-y-top`, `#crop-y-bottom` |
| Guardar recorte | `#save-segment-crop` / `Confirmar recorte` |
| Recuperar enfoque legible | `#focus-segment-start` / `Inicio del tramo` |
| Calibración | `#cal-value_min`, `#cal-value_max`, `#cal-depth_top`, `#cal-depth_bottom`, `#cal-scale`, `#cal-depth-unit`, `#cal-mnemonic`, `#cal-value-unit` |
| Guardar calibración | `#save-segment-calibration` / `Guardar calibración` |
| Renombrar | `[aria-label="Renombrar tramo"]`, `[aria-label="Nombre del tramo"]`, `[aria-label="Guardar nombre del tramo"]` |
| Procesar | `#process-curve` / `Procesar curva`; tras error `Reintentar curva` |
| Predicciones listas | Header contiene `2/2 tramos con predicción` para dos READY |
| Decidir solape | `select[id^="overlap-"]` (`required`, valor inicial vacío) |
| Muestreo conjunto | `#collection-depth-step` |
| Salidas | `Descargar LAS` / **`Analizar curva`** (no `Analyze curva`) |

Para QA de fuente no inferir el rango del raster entero ni defaults. La auditoría
de Shutts del coordinador distingue MAIN y REPEAT como pasadas solapadas: sus
recortes/rangos y la elección de solape deben configurarse explícitamente.

## Comandos y límites de verificación

Dependencias instaladas con `npm ci` en este checkout. No se modificó lockfile.
Vitest 2 falla con `URIError: URI malformed` si root contiene el `%` literal de
la ruta. Se creó un alias nuevo, exclusivo de este worktree (no aliases antiguos):

```sh
ln -s "$PWD" /private/var/folders/8d/gbzdh3717kxcbbbb00mlqqzr0000gn/T/opencode/wellsight-unified-fe-qa-20261004
npm test -- --run --root /private/var/folders/8d/gbzdh3717kxcbbbb00mlqqzr0000gn/T/opencode/wellsight-unified-fe-qa-20261004
npm run build
git diff --check
```

El `ln` se ejecutó desde `las-frontend/frontend`. El alias apunta directamente al
frontend de `.worktrees/wellsight-75-unified`, con preserveSymlinks heredado.

Las pruebas de UI usan fixtures de metadatos/HTTP y canvases sustituídos para
probar navegación, aislamiento, advertencias, cola, rename y salida única; las
pruebas unitarias de cola verifican progreso, secuencialidad, fallo/retry, READY,
reingreso frío, identidad y cancelación. No son evidencia científica de inferencia
de Shutts, continuidad física, trazado exacto ni QA visual real. El coordinador
realiza ese QA en sus puertos aislados UI 5176/API 8003/Postgres 55435 y produce
su reporte HTML; este agente no inició ni modificó esos servidores.

Resultado verificado: **258 tests / 26 archivos pasando** (233 heredados + 25
nuevos), `npm run build` exitoso y `git diff --check` limpio. La primera ejecución
sin alias falló por URI malformed (0 tests); se reran todos mediante el alias.
Las 14 pruebas del workspace cubren aislamiento crop/cal/strokes, cola de dos
miembros, READY, advertencia/reset, copia manual de escala, rename sin pérdida,
alta procedural, navegación local y salida conjunta. Los tests heredados de
colección ahora ejercitan el panel Resultado extraído, y nuevos tests de router
verifican las redirecciones, sin retirar sus verificaciones de revisión/solapes.

Advertencias de entorno existentes: npm ci reportó 20 vulnerabilidades de
dependencias (1 low, 7 moderate, 8 high, 4 critical). No se ejecutó audit fix ni
updates fuera de alcance. Vite avisa del bundle grande existente (>500 kB).

## Corrección de enfoque del tramo (posterior a QA02)

La captura `before-restart-prepared-one-workspace.png` del coordinador mostró el
inspector REPEAT con recorte y14662–16692, pero el canvas todavía en la cabecera
y0. No era un fallo de datos/inferencia: el visor conservaba su initialView de
ancho del raster. Se corrige sólo presentación, sin modificar recortes, escala
física, profundidad, arrays, predicciones ni ediciones.

- `focusRegionStart` es una transformación pura en viewport-transform. Calcula
  zoom a partir del **ancho** del recorte + 120 px de contexto del escaneo a cada
  lado (recortado a límites reales), margen de viewport 24 px. Se alinea arriba
  con 60 px de contexto fuente antes de y_top, en vez de centrar/fitear 10k filas.
  `clampScale` respeta MIN/MAX_SCALE; `clampView` ajusta los límites del raster sin
  cambiar zoom. En límites de la imagen se sacrifica margen, no legibilidad.
- La selección GR x25–528 incluye contexto hasta x648, de modo que las etiquetas
  de profundidad alrededor de x600 siguen visibles. El sombreado del contexto
  fuera del recorte es más suave únicamente en este modo unificado.
- `focusSavedCropStart` es opt-in, habilitado sólo por CurveSegmentEditor. Al
  montar/cambiar miembro y después de confirmar un recorte guardado, autofocus
  se ejecuta una vez cuando **ancho y alto** del viewport están medidos. Una firma
  de job + coordenadas impide que polls con objetos nuevos, escritura de drafts,
  resize o pan/zoom del operador recentren continuamente la imagen.
- usePanZoom inicializa primero; focus se aplica después mediante su callback
  que actualiza viewRef sincrónicamente y publica la vista en el siguiente frame.
  Mediciones iniciales de tamaño cero no consumen la firma de autofocus.
- **Inicio del tramo** (`#focus-segment-start`) recupera manualmente el foco sobre
  el rectángulo actualmente visible (incluido un borrador que el usuario quiera
  inspeccionar). Nunca guarda/muta ese rectángulo. El wizard legacy no recibe ni
  el autofocus ni el botón nuevo. Whole log continúa siendo overview manual del
  raster; no hay fit-height automático del tramo.

Se agregaron pruebas puras de regiones de 2k/10k/20k filas, contexto de x600,
alineación superior, clamping cerca del fondo, límites MIN/MAX y no mutación;
pruebas del hook con usePanZoom real para orden de inicialización, firmas,
poll/draft/pan/resize, cambio guardado y selección; y pruebas de editor/botón para
opt-in, foco exclusivamente al confirmar y comportamiento legacy intacto.

Verificación de esta corrección: **273 tests / 28 archivos pasan** (+15 tests de
enfoque sobre los 258 anteriores), TypeScript `--noEmit --incremental false`
exitoso y `git diff --check` limpio. Ningún build fue ejecutado en esta tanda.

**Importante para el coordinador:** no se ejecutó `npm run build` en esta tanda
porque QA02 utiliza assets precompilados. Sólo tests, TypeScript `--noEmit
--incremental false` y revisión del diff, sin tocar dist ni artefactos PFI/QA.
Cuando QA02 termine, ejecutar `npm run build` en este frontend y correr QA03 con
los assets nuevos. Verificar que seleccionar MAIN/REPEAT y confirmar su recorte
muestra el inicio correcto con GR/columna de profundidad legibles; panear luego
y verificar que polling o escribir inputs **no** deshace el pan; pulsar Inicio
del tramo para recuperar el encuadre. No inferir resultados visuales de QA03 a
partir de los tests de fixtures.
