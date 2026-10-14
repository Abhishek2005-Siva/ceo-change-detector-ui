# Leadership Change Detector — UI

A dashboard that shows how an AI system reads SEC **8-K filings** and detects when a company's **CEO is appointed or resigns**. It is written so a non-technical person can follow what is happening, and it also keeps a full reference of every model built and tested.

> **Model files are not in this repository.** Trained weights, training data, checkpoints and the training pipeline live in a separate private project. This repo contains only the front-end and the results data it displays.

## What the UI shows

| Page | For whom | What it shows |
|---|---|---|
| **Overview** | Everyone | Plain-language headline results, a dot-per-event view of what the AI caught and missed, the filings-to-short-list funnel, and how the best model was chosen |
| **How it works** | Non-technical readers | The five steps from raw filings to a verified list, a real worked example, what makes the task hard, and a glossary |
| **Search filings** | Anyone | A live version of the SEC filing search: keywords, company, form type, date range and a "leadership changes only" filter. Click any filing and the AI reads it, finds the CEO change and extracts the data |
| **Test results** | Anyone who wants to check the AI | Every flagged and missed CEO event from March 2025, searchable and filterable. Click a row to read the exact sentence and open the original SEC filing |
| **Why this model** | Decision makers | Ranking of the strongest candidates, why a mixed team of models won, the precision/recall trade-off, and what was tried but did not help |
| **Model notes** | The team | Every model built and tested, with every metric from the project logs (CEO detector versions v1–v13, encoder comparisons, ensembles, threshold sweeps, and the 1.03 / 3.01 / 4.01 / 2.01 / 1.01 / 1.02 / 5.07 detectors) |

## The best model found so far

A **mixed ensemble** of three AI readers: two RoBERTa-large models and one DeBERTa-v3-base model. A sentence is flagged only when at least two of the three agree and each is at least 70% confident.

- Average F1 over four unseen months: **0.8673** (best of all variants tested)
- March 2025, scored against an independent answer key:

| | Precision | Recall | F1 |
|---|---|---|---|
| New CEO appointed | 94.7% | 84.8% | 0.894 |
| CEO resigned | 95.8% | 79.3% | 0.868 |

Precision means "when it raises an alert, how often is it right". Recall means "of the real events, how many did it find".

**Caveat:** the answer key was produced by a separate large language model, not by hand-checking every filing.

## Architecture

```
Browser (React)  ──►  Vercel serverless API (api/*.ts)  ──►  SEC EDGAR (search, company list, filings)
                                   │
                                   └──►  Model service on Modal (backend/)  ──►  private adapters on Hugging Face
```

- `api/search`, `api/filings`, `api/companies`: proxy the SEC's public EDGAR endpoints (with the required contact User-Agent).
- `api/analyze`: starts and polls a model job. The browser never sees the model service address or key.
- `backend/`: FastAPI service. It downloads the filing, isolates Item 5.02, splits it into sentences and runs the three-reader ensemble (RoBERTa-large x2 + DeBERTa-v3-base, vote of at least 2 of 3 at confidence 0.7), then returns the extraction and each reader's vote. Runs on CPU on Modal and scales to zero when idle, so the first request after a quiet period takes about a minute longer.
- **The fine-tuned model files are never in this repository or on GitHub.** They live in a private Hugging Face model repo and are fetched by the service at startup using a Modal secret.

## Tech stack

- React 18 + TypeScript, built with Vite
- No UI or chart libraries: charts are plain HTML/CSS, routing is a tiny hash router
- Light and dark themes follow the system setting; layout is responsive and keyboard accessible

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks and builds to dist/
npm run preview    # serve the production build
```

## Project layout

```
src/
  pages/        Overview, HowItWorks, Explorer, ModelLab, Notes
  components/   Stat, Dots, BarChart, Highlight
  data/
    march2025.json   real predictions joined with the answer key (generated)
    notes.ts         all model experiments and metrics shown on the Notes page
scripts/
  build-data.mjs     regenerates march2025.json (maintainers only, see below)
```

## Updating the data

- **Model notes:** edit `src/data/notes.ts`. Each table is plain data (columns and rows).
- **Results explorer:** `scripts/build-data.mjs` joins a prediction file with its answer key and writes `src/data/march2025.json`. It reads files from the private training project, so it only runs there. The generated JSON is committed so the app builds anywhere.

## Deploying

**Model service (Modal)**

```bash
cd backend
modal secret create ceo-detector-secrets HF_TOKEN=... MODEL_REPO=<hf user>/<private adapters repo> API_KEY=<random> SEC_USER_AGENT="Your Name you@example.com"
modal deploy modal_app.py
```

**Website (Vercel)** — framework preset Vite, build command `npm run build`, output `dist`. Environment variables:

| Variable | Purpose |
|---|---|
| `SEC_USER_AGENT` | Contact string the SEC requires on automated requests, e.g. `Your Name you@example.com` |
| `MODEL_URL` | URL of the deployed Modal service |
| `MODEL_API_KEY` | Same value as `API_KEY` in the Modal secret |

Without `MODEL_URL`, search still works and the analysis page explains the model is not connected.
