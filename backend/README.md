---
title: Leadership Change Detector Model Service
emoji: 🔎
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Model service

FastAPI service that downloads an SEC 8-K filing, isolates Item 5.02 and runs the three-reader
ensemble (RoBERTa-large x2 + DeBERTa-v3-base). The fine-tuned adapters live in a **private** model
repository and are loaded at startup using the `HF_TOKEN` and `MODEL_REPO` Space secrets.

Endpoints: `GET /health`, `POST /jobs {cik, accession}`, `GET /jobs/{id}`.
