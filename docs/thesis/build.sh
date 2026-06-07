#!/usr/bin/env bash
# Compile the thesis chapters (in order) into a single PDF via pandoc + xelatex.
set -euo pipefail
cd "$(dirname "$0")"
pandoc \
  00-metadata.md \
  01-introduccion.md \
  02-related-work.md \
  03-metodologia.md \
  04-f1-embeddings.md \
  05-f2-multivector.md \
  06-f3-rerank.md \
  07-f4-multiobjetivo.md \
  08-discusion.md \
  09-conclusion-trabajo-futuro.md \
  10-plan-piloto.md \
  -o tesis.pdf \
  --pdf-engine=xelatex \
  --toc --number-sections
echo "[thesis] wrote tesis.pdf"
