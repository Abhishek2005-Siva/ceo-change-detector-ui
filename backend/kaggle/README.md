# Hosting the model service on Kaggle (free GPU) with an ngrok tunnel

The model service can run as a private Kaggle GPU kernel. The kernel starts the FastAPI service from `app/`, loads every
adapter from the private dataset `filinglens-adapters`, and exposes it through an ngrok tunnel on a static domain. The
website reads that address from `MODEL_URL`.

## One-time setup
1. Upload the adapters as a private Kaggle dataset (folder layout: `robertalarge_seed7/`, `deberta_seed42/`, `other/<name>/`).
2. Create a free ngrok account and claim a free static domain. Put these in the repo-root `.env` (git-ignored):
   `NGROK_AUTHTOKEN`, `NGROK_DOMAIN` (and `SEC_USER_AGENT`).
3. Point the site at the tunnel: set the Vercel env `MODEL_URL` to `https://<your ngrok domain>` (the API key stays the same).

## Start the server
```bash
cd backend/kaggle
API_KEY_FILE=/path/to/service-api-key ./build.sh     # fills secrets into ./out (git-ignored)
./start.sh                                           # pushes the kernel and deletes ./out
```
Optional: `RUN_HOURS=3 IDLE_MINUTES=30 ./build.sh`. The server stops after `RUN_HOURS` or after `IDLE_MINUTES` without any request.
Boot takes about 10-15 minutes the first time (pip installs, then loading all models onto the GPUs).

## Notes
- Kaggle sessions end after at most 12 hours, and GPU time counts against the weekly quota (shared with other jobs).
- The kernel is private and contains the API key and ngrok token. Never make it public.
- Colab is not an option: its free tier forbids serving web endpoints.
