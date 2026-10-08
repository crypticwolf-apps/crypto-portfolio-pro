#!/bin/bash
# Prepara las sesiones de Claude Code en la nube: instala Vitest para que las
# pruebas de cálculo financiero (finance.test.js) funcionen desde el primer
# momento. En el ordenador propio no hace nada.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Sin package-lock.json en el repositorio: no se crea uno nuevo.
npm install --no-audit --no-fund --no-package-lock
