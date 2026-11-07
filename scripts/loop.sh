#!/usr/bin/env bash
# Recoge lecturas cada 5 minutos durante LOOP_MINUTES y, al terminar, lanza la
# siguiente ejecución del workflow. Así la recogida no depende del programador de
# GitHub, que retrasa o se salta ejecuciones. El cron del workflow solo sirve de
# respaldo para reanudar la cadena si se rompe.
set -uo pipefail

LOOP_MINUTES="${LOOP_MINUTES:-55}"
INTERVAL="${INTERVAL:-300}"
REMOTE="${REMOTE:-https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git}"
end=$((SECONDS + ${LOOP_SECONDS:-$((LOOP_MINUTES * 60))}))
fail=0

publish() {
  rm -f out/.changed
  rm -rf out/.git
  ( cd out &&
    git init --quiet -b data &&
    git config user.name "github-actions[bot]" &&
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com" &&
    git add spots.json &&
    git commit --quiet -m "Lecturas $(date -u +%Y-%m-%dT%H:%MZ)" &&
    # Un único commit, reemplazado cada vez, para que el repositorio no crezca.
    git push --quiet --force "$REMOTE" data ) || echo "No se pudo publicar en la rama data"
  rm -rf out/.git
}

once() {
  rm -rf out && mkdir -p out
  # Si la rama no existe (código 2) es la primera ejecución. Cualquier otro error
  # salta esta vuelta: nunca se publica sobre un historial que no se ha podido leer.
  git ls-remote --exit-code --heads "$REMOTE" data > /dev/null
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    git fetch --quiet --depth=1 "$REMOTE" data &&
      git show FETCH_HEAD:spots.json > out/spots.json || { echo "No se pudo leer la rama data"; return 0; }
  elif [ "$rc" -ne 2 ]; then
    echo "No se pudo consultar la rama data (código $rc)"; return 0
  fi
  if node scripts/collect.mjs out/spots.json; then fail=0; else fail=1; fi
  [ -f out/.changed ] && publish
  return 0
}

while :; do
  echo "== $(date -u +%H:%M:%SZ)"
  once
  [ $((SECONDS + INTERVAL)) -ge "$end" ] && break
  sleep "$INTERVAL"
done

# Siguiente eslabón de la cadena. Si ya hay otra ejecución esperando, GitHub deja solo una.
if [ "${CHAIN:-1}" = "1" ]; then
  gh api -X POST "repos/${GITHUB_REPOSITORY}/actions/workflows/collect.yml/dispatches" -f ref="${GITHUB_REF_NAME:-main}" \
    && echo "Siguiente ejecución lanzada" || echo "No se pudo lanzar la siguiente ejecución"
fi
# GitHub desactiva las tareas programadas de repositorios públicos tras 60 días sin actividad.
gh api -X PUT "repos/${GITHUB_REPOSITORY}/actions/workflows/collect.yml/enable" > /dev/null 2>&1 || true

# Falla (y GitHub avisa por correo) solo si la última lectura tiene más de 2 h.
exit "$fail"
