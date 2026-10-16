# FilingLens

**See what happened in any SEC 8-K filing, in plain English.**

When something important happens at a US public company, it must tell the SEC in a document called an **8-K**. Thousands are filed every month and most are long and technical. FilingLens searches the SEC's public filings database, reads a filing you pick with AI, and tells you what changed: a new CEO, a bankruptcy, a delisting notice, a new auditor, how shareholders voted. Every answer comes with the exact sentence it is based on and a link to the original filing.

> **Model files are not in this repository.** Trained weights, training data and checkpoints live in a separate private project and a private Hugging Face model repo. This repo contains the front-end, the serverless API, the model-service code (no weights) and the results data it displays.

## What it detects

Every filing you open is run through **all** of these detectors; each one only reports when its 8-K Item is present.

| Detector | 8-K Item | Model | Held-out result |
|---|---|---|---|
| **CEO appointed or leaving** | 5.02 | 3 readers vote: RoBERTa-large x2 + DeBERTa-v3, per sentence | March 2025: new CEO 94.7% right / 84.8% found; CEO leaving 95.8% / 79.3% |
| **CFO appointed or leaving** | 5.02 | 4 RoBERTa-large fold models averaged | Cross-validation: new CFO 95.8% / 93.7%; CFO leaving 88.6% / 91.3% |
| **Bankruptcy or receivership** | 1.03 | RoBERTa-large + DeBERTa-v3, section level, date-aware | 149 events: 94.7% right / 96.0% found |
| **Delisting or listing notice** | 3.01 | RoBERTa-large x2 + DeBERTa-v3, section level | 477 events: deficiency 97% / 92%, exchange delisting 90% / 89%, voluntary 95% / 99% |
| **Change of auditor** | 4.01 | RoBERTa-base + rule engine | 348 filings: F1 0.97-0.99 on dismissed / resigned / engaged / reportable event |
| **Shareholder vote results** | 5.07 | RoBERTa-base + rule engine + vote-table parser | 589 filings: F1 0.96-0.99 on directors, auditor, say-on-pay, equity plan |
| **Acquisition / sale completed** *(experimental)* | 2.01 | RoBERTa-base sentences + RoBERTa-large direction | Deal completed F1 0.95; who-bought-whom 90% |
| **Material agreements** *(experimental)* | 1.01 / 1.02 | RoBERTa-base event + type readers | Entered F1 0.94, ended F1 0.88; type is a hint only |
| **Unregistered equity sales** *(experimental)* | 3.02 | RoBERTa-base sale + type readers | No independent accuracy yet |
| **Earnings guidance** *(experimental)* | 2.02 | RoBERTa-large on the press release | Accuracy 90.6%, macro-F1 0.77 |
| **Restructuring / impairment** *(experimental)* | 2.05 / 2.06 | RoBERTa-large (seed 123) | Accuracy 95.4%, macro-F1 0.86 (random split) |

Each detector uses the best honestly-measured model found for that event type. "Experimental" means the testing is thinner (small or tuned-on test sets, or labels made by rules). Models that were tested but not selected, and every per-model metric, are on the **Model notes** page. Not included yet: a single frozen CFO model, restatements (4.02), cybersecurity (1.05).

**Caveats:** accuracy is scored against answer keys built from a separate large AI model plus rules, with disagreements hand-checked for some detectors, so treat the numbers as strong estimates, not guarantees. FilingLens is a research tool, not financial or legal advice.

## Pages

| Page | What it shows |
|---|---|
| **Overview** | What FilingLens does, every detector with its tested accuracy, and a closer look at how the CEO detector was chosen |
| **Search filings** | A live version of the SEC filing search: keywords, company, form type, date range and a "type of event" filter. Click any filing to analyze it |
| **Filing analysis** | Live progress with a countdown, then every event found, how sure the AI is, how each reader voted, the evidence sentence, extracted details and a copyable JSON |
| **How it works** | The five steps from a filing to a checkable answer, a real example, and a glossary |
| **CEO test results** | Every flagged and missed CEO event from March 2025, searchable, with links to the SEC filing |
| **Why these models** | How the best CEO model was chosen and what did not help |
| **Model notes** | Every model built and tested, with every metric from the project logs |

A header button turns the AI model server on (it sleeps when idle to stay free) and shows start-up progress.

## Architecture

```
Browser (React)  -->  Vercel serverless API (api/*.ts)  -->  SEC EDGAR (search, company list, filings)
                                   |
                                   +-->  Model service on Modal (backend/)  -->  private adapters on Hugging Face
```

- `api/search`, `api/filings`, `api/companies`: proxy the SEC's public EDGAR endpoints (with the required contact User-Agent).
- `api/analyze`: starts and polls a model job. The browser never sees the model service address or key.
- `backend/`: FastAPI service. It downloads the filing once, parses it two ways (plain text and table-preserving text), finds each Item's section, and runs every applicable detector with the exact pipeline that detector was trained and tested with (ten detectors, 20 model adapters). The CEO ensemble is preloaded from a memory snapshot; the other detectors load in the background after start-up, using about 22 GB of RAM in total.
- Speed work that keeps predictions unchanged: LoRA adapters are merged into the base weights, sentences are batched by length, and the CEO check is skipped when the section never mentions a CEO or president. int8 quantization was tested and rejected because it changed real decisions.
- **The fine-tuned model files are never in this repository or on GitHub.** They live in a private Hugging Face model repo and are fetched by the service at startup using a Modal secret.

## Tech stack

- React 18 + TypeScript, built with Vite
- No UI or chart libraries: charts are plain HTML/CSS, routing is a tiny hash router
- Light and dark themes follow the system setting; layout is responsive and keyboard accessible

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173 (search and analysis need the Vercel API; use `vercel dev`)
npm run build      # type-checks and builds to dist/
npm run preview    # serve the production build
```

## Project layout

```
src/
  pages/        Overview, Search, Filing, HowItWorks, Explorer, ModelLab, Notes
  components/   DetectorCard, WaitLoader, ModelPower, CompanyPicker, Stat, Dots, BarChart, Highlight
  data/
    detectors.ts     the detector catalogue and its recorded accuracy
    notes.ts         all model experiments and metrics shown on the Model notes page
    march2025.json   real CEO predictions joined with the answer key (generated)
api/                serverless functions (SEC proxy + model proxy)
backend/            model service (FastAPI + Modal deploy file)
  app/detect/       Item slicers, input builders and rule engines for the other detectors
scripts/
  build-data.mjs    regenerates march2025.json (maintainers only)
```

## Deploying

**Model service (Modal)**

```bash
cd backend
modal secret create ceo-detector-secrets HF_TOKEN=... MODEL_REPO=<hf user>/<private adapters repo> API_KEY=<random> SEC_USER_AGENT="Your Name you@example.com"
modal deploy modal_app.py
```

**Website (Vercel)**: framework preset Vite, build command `npm run build`, output `dist`. Environment variables:

| Variable | Purpose |
|---|---|
| `SEC_USER_AGENT` | Contact string the SEC requires on automated requests, e.g. `Your Name you@example.com` |
| `MODEL_URL` | URL of the deployed Modal service |
| `MODEL_API_KEY` | Same value as `API_KEY` in the Modal secret |

Without `MODEL_URL`, search still works and the analysis page explains the model is not connected.
