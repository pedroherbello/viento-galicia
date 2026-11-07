# Viento Coruña y Cangas

Viento medio y racha máxima cada 10 minutos, en nudos, en tres estaciones de MeteoGalicia:
Coruña-Dique (14000), Punta Langosteira (14003) y Cangas-Porto (10906).

## Cómo funciona

- **Recogida.** `.github/workflows/collect.yml` se ejecuta cada 5 minutos. Ejecuta `scripts/collect.mjs`, que:
  - lee la última lectura de 10 minutos de MeteoGalicia (servicio público `servizos.meteogalicia.gal`);
  - cada 30 minutos lee también la racha máxima horaria de las últimas 48 h;
  - lo guarda en `spots.json` en la rama `data`.
- **Tamaño del repositorio.** La rama `data` tiene un único commit que se reemplaza en cada actualización, así que el repositorio no crece.
- **Web.** `index.html` se publica con GitHub Pages desde la rama `main`. Lee `spots.json` de la rama `data` y se recarga sola cada 2 minutos.
- **Lecturas que se conservan.**
  - Lecturas de 10 minutos: los últimos 7 días.
  - Histórico horario: las últimas 50 horas.

## Puesta en marcha

1. En **Settings → Pages**, elige *Deploy from a branch*, rama `main` y carpeta `/ (root)`.
2. En **Actions**, ejecuta a mano *Recoger viento* (*Run workflow*) la primera vez.

## Avisos

- GitHub puede retrasar unos minutos las tareas programadas. Si se pierde una lectura, la gráfica muestra en gris la racha máxima de esa hora.
- MeteoGalicia solo publica la última lectura de 10 minutos. Las lecturas anteriores a la puesta en marcha no se pueden recuperar.
- Si una ejecución falla porque MeteoGalicia no responde, GitHub lo marca en rojo en **Actions** y te avisa por correo.

Para probar en local: `python3 -m http.server`, con un `data/spots.json` de ejemplo.
