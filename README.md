# Rutas de muestreo de suelos — puntos cLHS por ingenio

Aplicación web de campo para la **planificación, navegación y seguimiento del muestreo de suelos** del proyecto de
estimación del **stock de carbono orgánico del suelo (COS)** en áreas cultivadas con caña de azúcar de los ingenios
**Incauca, Manuelita, Providencia y Riopaila Castilla (planta Castilla)**, valle geográfico del río Cauca, Colombia.

**🌐 Aplicación:** https://pracagro2-hash.github.io/rutas-muestreo-suelos/

| Ingenio | Aplicación de campo | Plan para QField / Google Earth |
|---|---|---|
| Incauca | [incauca.html](https://pracagro2-hash.github.io/rutas-muestreo-suelos/incauca.html) | [rutas_incauca.kml](rutas_incauca.kml) |
| Manuelita | [manuelita.html](https://pracagro2-hash.github.io/rutas-muestreo-suelos/manuelita.html) | [rutas_manuelita.kml](rutas_manuelita.kml) |
| Providencia | [providencia.html](https://pracagro2-hash.github.io/rutas-muestreo-suelos/providencia.html) | [rutas_providencia.kml](rutas_providencia.kml) |
| Castilla | [castilla.html](https://pracagro2-hash.github.io/rutas-muestreo-suelos/castilla.html) | [rutas_castilla.kml](rutas_castilla.kml) |

## Funcionalidades

- **Mapa satelital** (o de calles) con las rutas de cada día en su color y cada punto identificado por su ID.
- **Ubicación GPS en tiempo real**: triángulo que apunta en la dirección de avance, círculo de precisión y modo *seguirme*;
  distancia del usuario a cada punto.
- **Registro del recorrido real**: mientras la ubicación está activa se guarda en el celular cada desplazamiento (≥ 10 m o
  cada 30 s, con hora, velocidad y precisión), se dibuja en el mapa y se exporta a GeoJSON para calibrar los tiempos del modelo de rutas.
- **Filtros** por día y por estado; botones para ver todas las rutas y para ir al **siguiente punto pendiente**.
- **Ficha de cada punto:** estado (*Pendiente*, *En camino*, *Realizado*, *Con inconvenientes*), fecha y hora,
  responsable, profundidad, humedad del suelo, observaciones, **fotografías**, historial de cambios y navegación
  con Google Maps. Botones *Marcar como realizado*, *Guardar borrador*, *Editar información* y *Reportar inconveniente*.
- **Lista** de puntos por día con buscador y **estadísticas** de avance general y por día (calculadas con los registros
  guardados; distancias y tiempos tomados del plan de rutas).
- **Persistencia:** registros y fotos se guardan en el celular (IndexedDB) y se conservan al cerrar el navegador o reiniciar.
- **Sin conexión:** la aplicación, los datos del plan y los mosaicos del mapa ya visualizados quedan en caché
  (service worker); los cambios hechos sin señal se sincronizan al recuperar internet.
- **Base de datos central (Supabase), opcional:** sincronización entre usuarios autorizados, historial en el servidor,
  detección de conflictos (nunca se sobrescribe en silencio) y fotos en almacenamiento privado.
  Configuración: [docs/CONFIGURACION_SUPABASE.md](docs/CONFIGURACION_SUPABASE.md).
- **Exportación** de los registros a CSV y de los puntos con su estado a GeoJSON. Instalable en el celular (PWA).

## Resumen del plan

<!-- RESUMEN_PLAN_INICIO -->
| Ingenio | Sede (salida y regreso) | Puntos | Días (con contingencia) | Km | Horas de viaje | Horas de muestreo | Costo con contingencia (COP) |
|---|---|---|---|---|---|---|---|
| [Incauca](https://pracagro2-hash.github.io/rutas-muestreo-suelos/incauca.html) | Sede Incauca (Miranda, Cauca) | 45 | 12 (15) | 557 | 20,1 | 78,1 | $7.662.389 |
| [Manuelita](https://pracagro2-hash.github.io/rutas-muestreo-suelos/manuelita.html) | Ingenio Manuelita (Palmira) | 45 | 13 (16) | 640 | 23,3 | 80,4 | $8.322.873 |
| [Providencia](https://pracagro2-hash.github.io/rutas-muestreo-suelos/providencia.html) | Ingenio Providencia (El Cerrito) | 45 | 13 (16) | 680 | 23,5 | 79,9 | $8.356.068 |
| [Castilla](https://pracagro2-hash.github.io/rutas-muestreo-suelos/castilla.html) | Riopaila Castilla – planta Castilla (Pradera) | 45 | 14 (17) | 944 | 30,1 | 80,7 | $8.811.395 |
| **Total** | | **180** | **52 (64)** | **2.822** | | | **$33.152.724** |

_Plan generado el 07/10/2026 · jornada máxima 9 h · 90 min de muestreo por punto · red vial de OpenStreetMap con callejones, tiempos calibrados con OSRM._
<!-- RESUMEN_PLAN_FIN -->

## Metodología del plan de rutas

1. **Puntos de muestreo.** 45 puntos por ingenio seleccionados mediante Hipercubo Latino Condicionado (cLHS) sobre el
   área efectiva de suertes de manejo directo, con covariables ambientales a la edad real del cultivo.
2. **Red vial.** Red propia construida desde OpenStreetMap que incluye callejones cañeros y caminos de finca
   (`highway=track` y `service`); los tiempos de viaje se calibran con el servidor OSRM. Cada punto se conecta a la
   vía más cercana y el tramo restante se recorre a pie (4 km/h, ida y vuelta).
3. **Optimización por jornadas.** Algoritmo de ahorros de Clarke-Wright con restricción de duración de la jornada,
   orden óptimo de visita dentro de cada día y consolidación de días. Las rutas siguen la red vial real (no son líneas rectas).
4. **Jornada.** Máximo 9 horas con salida y regreso a la sede de cada ingenio: *tiempo de viaje + tiempo en campo*
   (90 min de muestreo por punto en 0–15 y 15–30 cm, más el acceso a pie); los días con mayor recorrido incluyen
   menos puntos. Factores de riesgo de 1,2 (transporte) y 1,1 (campo).
5. **Costos.** ACPM, peajes en la ruta, jornales y viáticos por día, más 20 % de contingencia en días.

## Uso en campo

1. Abrir el link del ingenio en el celular (se recomienda *Agregar a la pantalla de inicio* para usarla como aplicación).
2. Elegir el día de trabajo en el selector superior y activar 📍 para ver la ubicación en tiempo real.
3. Tocar un punto → *Navegar a este punto* (Google Maps) → al llegar, registrar los datos y *Marcar como realizado*.
4. ⏭️ lleva al siguiente punto pendiente; la pestaña **Estadísticas** muestra el avance.

**QField:** descargar `rutas_<ingenio>.kml`, copiarlo al celular y abrirlo en QField (*Abrir archivo local*). Se cargan
tres capas: **Sede**, **Rutas por día** y **Puntos de muestreo**, con todos sus atributos.

## Estructura del repositorio

| Ruta | Contenido |
|---|---|
| `index.html` | Portada con acceso a los cuatro ingenios y su avance |
| `incauca.html`, `manuelita.html`, `providencia.html`, `castilla.html` | Aplicación de campo de cada ingenio (generadas desde `app/plantilla_ingenio.html`) |
| `app/` | Código común: `app.js` (interfaz y mapa), `logica.js` (estados y estadísticas), `almacen.js` (IndexedDB), `sync.js` (Supabase), `config.js`, `app.css`, íconos |
| `data/<ingenio>.js` | Puntos y rutas del plan en GeoJSON (EPSG:4326) con metadatos |
| `rutas_<ingenio>.kml` | Plan para QField / QGIS / Google Earth |
| `sw.js`, `manifest.webmanifest` | Funcionamiento sin conexión e instalación en el celular |
| `supabase/` | Migración SQL de la base de datos y semilla de puntos |
| `docs/CONFIGURACION_SUPABASE.md` | Pasos para activar la base de datos central |
| `tests/pruebas.html` | Pruebas de estadísticas, cambios de estado, historial, conflictos y persistencia |

Los datos (`data/`, `*.kml`, páginas de ingenio y `supabase/semilla_puntos.sql`) se regeneran con el notebook
`PLANIFICACION_RUTAS_MUESTREO.ipynb`; el código de `app/` no cambia al regenerar. Al publicar cambios de código,
incrementar `VERSION` en `sw.js` para que los celulares descarguen la nueva versión.

## Supuestos y limitaciones

- Las coordenadas de las sedes provienen de OpenStreetMap y pueden ajustarse al punto exacto de salida.
- Los tiempos son estimaciones del plan; el estado de las vías, el clima y los permisos de acceso pueden modificarlos.
- Los callejones no mapeados en OpenStreetMap no se consideran; el acceso final al punto se estima a pie.
- Sin la base de datos central configurada, los registros se guardan solo en cada celular.
- Sin conexión, el mapa muestra los mosaicos que ya se visualizaron con internet en ese celular.

---

**Elaborado por:** Diego Fernando Angrino — Maestría, Universidad Icesi · Cenicaña  
**Herramientas:** Python (GeoPandas, NetworkX), OpenStreetMap, OSRM, Leaflet y Supabase
