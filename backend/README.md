# Model service

FastAPI service, deployed on Modal (`modal deploy modal_app.py`). It downloads an SEC 8-K filing, isolates Item 5.02 and runs the three-reader ensemble (RoBERTa-large x2 + DeBERTa-v3-base). The fine-tuned adapters live in a **private** Hugging Face model repo and are loaded at startup via the `ceo-detector-secrets` Modal secret.


Endpoints: `GET /health`, `POST /jobs {cik, accession}`, `GET /jobs/{id}` (all require `Authorization: Bearer <API_KEY>`).
