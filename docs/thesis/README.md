# Tesis — Personalización de ranking (programa F0–F5)

Documento de tesis sintetizando el programa F0–F4. Capítulos en Markdown,
compilados a un único PDF.

## Capítulos
1. `01-introduccion.md` — problema, crítica de partida, contribuciones.
2. `02-related-work.md` — estado del arte.
3. `03-metodologia.md` — simulador con ground-truth + arnés de evaluación.
4. `04-f1-embeddings.md` — estudio de embeddings comerciales.
5. `05-f2-multivector.md` — usuario multi-vector + modelo de regalo.
6. `06-f3-rerank.md` — pool multi-fuente + estudio de rerankers.
7. `07-f4-multiobjetivo.md` — ranking multi-objetivo y frontera de Pareto.
8. `08-discusion.md` — discusión, límites, validez.
9. `09-conclusion-trabajo-futuro.md` — conclusión y trabajo futuro.
10. `10-plan-piloto.md` — diseño del piloto A/B (no ejecutado).

## Compilar el PDF
Requiere `pandoc` y `xelatex` (`sudo apt-get install -y pandoc texlive-xetex texlive-fonts-recommended`).

```bash
bash docs/thesis/build.sh   # → docs/thesis/tesis.pdf
# o:  make -C docs/thesis pdf
```

## Trazabilidad
Toda cifra de resultados se cita de un reporte commiteado en
`docs/superpowers/reports/` (F0 baseline, F1, F2, F3, F4). Ninguna cifra es
estimada.
