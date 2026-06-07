---
title: "Personalización de ranking para e-commerce reseller: un estudio empírico de embeddings comerciales, representación multi-vector del usuario, reranking contextual y ranking multi-objetivo"
author: "Yosvany Castro"
date: "2026"
lang: es
toc: true
toc-depth: 2
numbersections: true
geometry: margin=2.5cm
fontsize: 11pt
pdf-engine: xelatex
abstract: |
  Este trabajo eleva el pipeline de personalización de un e-commerce reseller
  (reventa de catálogo Amazon/AliExpress sin stock físico, donde cada llamada al
  agregador tiene costo real) desde una heurística de relevancia única a un
  sistema de ranking de dos etapas evaluado con rigor. Sobre un simulador de
  marketplace con verdad de fondo conocida y un arnés de evaluación con holdout
  temporal, se estudian empíricamente cuatro contribuciones: (1) embeddings
  comerciales (texto, Prod2Vec, híbrido, two-tower, late-interaction,
  contextualizado), hallando que capturan relevancia pero no complementariedad;
  (2) representación multi-vector del usuario con un modelo explícito de regalo,
  que supera al vector único sobre todo en sesiones de regalo; (3) un pool de
  candidatos multi-fuente con cuatro familias de reranker, que cambian el
  conjunto recuperado pero no superan a la fusión RRF en relevancia pura; y
  (4) ranking multi-objetivo, cuya frontera de Pareto permite negociar
  explícitamente relevancia y revenue. Se reportan los hallazgos negativos con la
  misma honestidad que los positivos, y se diseña —sin ejecutarlo— un piloto A/B
  para producción.
---
