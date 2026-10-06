# Rutas de muestreo de suelos — puntos cLHS

Mapas interactivos con el plan de rutas de muestreo de los ingenios Incauca, Manuelita, Providencia y Castilla.

| Página | Contenido |
|---|---|
| `index.html` | Portada con acceso a los mapas |
| `incauca.html` · `manuelita.html` · `providencia.html` · `castilla.html` | Ruta de cada ingenio, una capa por día |
| `general.html` | Los 4 ingenios en un mismo mapa |

## Cómo publicarlo con GitHub Pages
1. En GitHub: **New repository** → nombre (por ejemplo `rutas-muestreo-suelos`) → *Create repository*.
2. **Add file → Upload files** → arrastrar TODOS los archivos de esta carpeta (`index.html`, los 4 mapas,
   `general.html` y este `README.md`) → *Commit changes*.
3. **Settings → Pages** → *Source*: *Deploy from a branch* → rama `main`, carpeta `/ (root)` → *Save*.
4. En 1–2 minutos quedan los links:
   - Portada: `https://<usuario>.github.io/rutas-muestreo-suelos/`
   - Incauca: `https://<usuario>.github.io/rutas-muestreo-suelos/incauca.html` (igual para los demás ingenios)

Para actualizar: volver a correr `PLANIFICACION_RUTAS_MUESTREO.ipynb` y subir de nuevo los archivos (se reemplazan).
