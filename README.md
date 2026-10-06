# Rutas de muestreo de suelos — puntos cLHS por ingenio

Plan logístico y mapas interactivos para el muestreo de suelos del proyecto de **estimación del stock de carbono
orgánico del suelo (COS)** en áreas cultivadas con caña de azúcar de los ingenios **Incauca, Manuelita, Providencia
y Riopaila Castilla (planta Castilla)**, valle geográfico del río Cauca, Colombia.

Para cada ingenio se define el orden de visita de sus 45 puntos de muestreo, agrupados en jornadas de campo que salen
y regresan a la sede del ingenio, con tiempos, distancias y costos estimados.

**🌐 Portada:** https://pracagro2-hash.github.io/rutas-muestreo-suelos/

## Mapas y archivos por ingenio

| Ingenio | Mapa interactivo | Archivo para QField / Google Earth |
|---|---|---|
| Incauca | [Ver mapa](https://pracagro2-hash.github.io/rutas-muestreo-suelos/incauca.html) | [rutas_incauca.kml](rutas_incauca.kml) |
| Manuelita | [Ver mapa](https://pracagro2-hash.github.io/rutas-muestreo-suelos/manuelita.html) | [rutas_manuelita.kml](rutas_manuelita.kml) |
| Providencia | [Ver mapa](https://pracagro2-hash.github.io/rutas-muestreo-suelos/providencia.html) | [rutas_providencia.kml](rutas_providencia.kml) |
| Castilla | [Ver mapa](https://pracagro2-hash.github.io/rutas-muestreo-suelos/castilla.html) | [rutas_castilla.kml](rutas_castilla.kml) |

Cada mapa muestra el **ID de cada punto** y la ruta de cada día en un color. Al tocar un punto se consultan el día y el
orden de visita, la hora estimada de llegada, la suerte, la edad del cultivo, el acceso a pie desde la vía y un enlace
para navegar con Google Maps. El botón de ubicación muestra la posición del celular sobre el mapa.

## Resumen del plan

| Ingenio | Sede (salida y regreso) | Puntos | Días (con contingencia) | Km | Horas de viaje | Horas de muestreo | Costo estimado con contingencia (COP) |
|---|---|---|---|---|---|---|---|
| Incauca | Sede Incauca (Miranda, Cauca) | 45 | 12 (15) | 583 | 21,1 | 78,0 | $7.672.819 |
| Manuelita | Ingenio Manuelita (Palmira) | 45 | 13 (16) | 640 | 23,3 | 80,4 | $8.322.873 |
| Providencia | Ingenio Providencia (El Cerrito) | 45 | 13 (16) | 680 | 23,5 | 79,9 | $8.356.068 |
| Castilla | Riopaila Castilla – planta Castilla (Pradera) | 45 | 14 (17) | 944 | 30,1 | 80,7 | $8.811.395 |
| **Total** | | **180** | **52 (64)** | **2.848** | | | **$33.163.154** |

## Metodología

1. **Puntos de muestreo.** 45 puntos por ingenio seleccionados mediante Hipercubo Latino Condicionado (cLHS) sobre el
   área efectiva de suertes de manejo directo, con covariables ambientales a la edad real del cultivo.
2. **Red vial.** Las rutas se calculan sobre una red vial propia construida desde OpenStreetMap que incluye callejones cañeros y caminos de finca (`highway=track` y `service`), con tiempos de viaje calibrados con el servidor OSRM. Cada punto se conecta a la vía más cercana; el tramo restante
   se recorre a pie a 4,0 km/h (ida y vuelta).
3. **Matriz de tiempos.** Se calcula el tiempo y la distancia por carretera entre la sede y todos los puntos de cada ingenio.
4. **Optimización por jornadas.** Los puntos se agrupan en días con el algoritmo de ahorros de Clarke-Wright con
   restricción de duración de la jornada; luego se determina el orden óptimo de visita dentro de cada día y se
   consolidan los días con menos puntos.
5. **Duración de la jornada.** Máximo 9 horas por día, con salida a las 06:30:
   *tiempo de viaje + tiempo en campo*. El tiempo en campo es de 90 min por punto
   (profundidades 0–15 y 15–30 cm) más el acceso a pie. Por eso, **los días con mayor recorrido incluyen menos puntos**.
   Se aplican factores de riesgo de 1,2 (transporte) y 1,1 (campo).
6. **Costos por día.** ACPM (40 km/galón a $13.000/galón), peajes en la ruta
   ($14.000 c/u), 2 jornales de $66.700 y viáticos de $360.000.
   Se agrega una contingencia del 20% en días por lluvia y logística.

## Uso en campo

**Mapa en el celular.** Abrir el link del ingenio, activar el botón de ubicación y, en el control de capas, dejar
visible solo el día de trabajo. El enlace *Cómo llegar* de cada punto abre la navegación en Google Maps.

**QField.**
1. Descargar el archivo `rutas_<ingenio>.kml` del ingenio.
2. Copiarlo al celular (por cable, correo o almacenamiento en la nube).
3. En QField: *Abrir archivo local* → seleccionar el KML.
4. Se cargan tres capas: **Sede**, **Rutas por día** y **Puntos de muestreo**. Cada punto conserva sus atributos
   (ID, día, orden, horas estimadas, suerte, edad del cultivo, acceso a pie y coordenadas).

## Supuestos y limitaciones

- Las coordenadas de las sedes provienen de OpenStreetMap y pueden ajustarse al punto exacto de salida.
- Los tiempos de viaje son estimaciones; el estado de las vías, el clima y los permisos de acceso a las haciendas
  pueden modificarlos.
- Los callejones no mapeados en OpenStreetMap no se consideran; el acceso final al punto se estima a pie.

## Contenido del repositorio

| Archivo | Descripción |
|---|---|
| `index.html` | Portada con acceso a los mapas de cada ingenio |
| `incauca.html`, `manuelita.html`, `providencia.html`, `castilla.html` | Mapas interactivos de rutas por ingenio |
| `rutas_<ingenio>.kml` | Sede, rutas por día y puntos de muestreo con atributos (QField, QGIS, Google Earth) |

---

**Elaborado por:** Diego Fernando Angrino — Maestría, Universidad Icesi · Cenicaña  
**Herramientas:** Python (GeoPandas, NetworkX, Folium), OpenStreetMap y OSRM · **Plan generado:** 06/10/2026
