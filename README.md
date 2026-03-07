# EPANET Map Viewer

Aplicacion web en Python para cargar un archivo EPANET (`.net` o `.inp`) desde el equipo del usuario y dibujar la red de tuberias sobre un mapa satelital real.

## Caracteristicas

- Carga de archivo local desde el navegador (sin rutas locales hardcodeadas).
- Parseo de secciones EPANET: `[PIPES]`, `[COORDINATES]`, `[JUNCTIONS]`, `[RESERVOIRS]`, `[TANKS]`, `[VERTICES]`.
- EPANET no requiere un CRS especifico: puede trabajar con coordenadas cartesianas arbitrarias (XY) o proyectadas (UTM).
- Visualizacion en mapa satelital (Esri World Imagery) usando Leaflet.
- Controles de visualizacion:
  - Mostrar/ocultar nodos.
  - Mostrar/ocultar tanques y reservorios.
  - Elegir color de tuberias, nodos y reservorios/tanques por separado.
  - Ajustar estilo por elemento: grosor de tuberia, radio de nodos y tamano de reservorios.
  - Los reservorios se dibujan como marcadores cuadrados.
- Soporta modos de coordenadas:
  - `Local` (recomendado): para layout XY arbitrario; proyecta `x/y` alrededor de una lat/lon base + `metros por unidad`.
  - `UTM`: interpreta `x=easting`, `y=northing` usando una zona UTM (ej: `14Q`, `30T`).

## Estructura

- `/api/index.py`: backend Flask y parser EPANET.
- `/templates/index.html`: UI principal.
- `/static/app.js`: logica cliente y dibujo de red.
- `/static/styles.css`: estilos.
- `/vercel.json`: configuracion de deploy en Vercel.

## Ejecutar localmente

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python api/index.py
```

Abrir: `http://127.0.0.1:5000`

## Referencia rapida de georreferenciacion

- Si tu archivo EPANET tiene coordenadas cartesianas locales (no geograficas), usa `Local`.
- Si tu archivo esta en UTM (Easting/Northing en metros), usa `UTM` y especifica la zona (`14Q`, `30T`, etc.).

## Deploy en Vercel

```bash
npm i -g vercel
vercel login
vercel --prod
```

Vercel usara automaticamente `vercel.json` y ejecutara `api/index.py` como funcion Python.

## Nota sobre archivos `.NET`

Por seguridad del navegador no se puede leer directamente una ruta del sistema del usuario desde el servidor.  
La app resuelve esto pidiendo al usuario seleccionar el archivo local; el navegador lo sube al backend para parsearlo.
