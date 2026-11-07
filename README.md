# Viento Coruña y Cangas

Viento medio y racha máxima cada 10 minutos, en nudos, en tres estaciones de MeteoGalicia:
Coruña-Dique (14000), Punta Langosteira (14003) y Cangas-Porto (10906).

## Cómo funciona

- **Recogida.** `.github/workflows/collect.yml` se ejecuta cada 5 minutos (minutos 3, 8, 13…). Ejecuta `scripts/collect.mjs`, que:
  - lee la última lectura de 10 minutos de MeteoGalicia (servicio público `servizos.meteogalicia.gal`);
  - cada 30 minutos lee también la racha máxima horaria de las últimas 48 h;
  - lo guarda en `spots.json` en la rama `data`.
- **Tamaño del repositorio.** La rama `data` tiene un único commit que se reemplaza en cada actualización, así que el repositorio no crece.
- **Web.** `index.html` se publica con GitHub Pages desde la rama `main`. Lee `spots.json` de la rama `data` y se recarga sola cada 2 minutos.
- **Lecturas que se conservan.**
  - Lecturas de 10 minutos y histórico horario: las últimas 50 horas.

## Puesta en marcha

1. En **Settings → Pages**, elige *Deploy from a branch*, rama `main` y carpeta `/ (root)`.
2. En **Actions**, ejecuta a mano *Recoger viento* (*Run workflow*) la primera vez.

## Avisos

- GitHub puede retrasar unos minutos las tareas programadas. Si se pierde una lectura, la gráfica muestra en gris la racha máxima de esa hora.
- MeteoGalicia solo publica la última lectura de 10 minutos. Las lecturas anteriores a la puesta en marcha no se pueden recuperar.
- Si pasan más de 2 horas sin lecturas nuevas, las ejecuciones fallan y GitHub te avisa por correo. Los cortes más cortos no generan avisos.
- Si no se puede leer la rama `data`, la ejecución se detiene sin publicar nada, para no perder el historial.
- La web puede mostrar los datos con hasta 5 minutos de retraso, por la caché de GitHub.
- GitHub desactiva las tareas programadas de repositorios públicos tras 60 días sin actividad. El workflow se reactiva solo en cada ejecución; si aun así se parase, actívalo en **Actions → Recoger viento → Enable workflow**.

Para probar en local: `python3 -m http.server`, con un `data/spots.json` de ejemplo.
