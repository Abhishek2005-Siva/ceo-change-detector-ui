"""Deploys the model service on Modal (serverless, scales to zero when idle).

    modal deploy modal_app.py

The fine-tuned adapters are NOT in this repo or image: they are pulled at startup from a private
Hugging Face model repo using the secret `ceo-detector-secrets` (HF_TOKEN, MODEL_REPO, API_KEY, SEC_USER_AGENT).
"""
import modal

BASES = (
    "from huggingface_hub import snapshot_download as s; "
    "s('roberta-large', allow_patterns=['*.json','*.safetensors','*.txt']); "
    "s('microsoft/deberta-v3-base', allow_patterns=['*.json','*.safetensors','*.txt','*.model'])"
)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .env({"HF_HUB_DISABLE_XET": "1"})
    .pip_install_from_requirements("requirements.txt")
    .pip_install("torch", index_url="https://download.pytorch.org/whl/cpu")
    .run_commands(f'python -c "{BASES}"')  # public base models baked in => faster cold starts
    .add_local_dir("app", remote_path="/root/app")
)

app = modal.App("leadership-change-detector", image=image)


@app.function(
    cpu=4.0,
    memory=8192,
    secrets=[modal.Secret.from_name("ceo-detector-secrets")],
    max_containers=1,  # jobs live in this container's memory, so keep exactly one
    scaledown_window=180,
    timeout=1800,
)
@modal.concurrent(max_inputs=32)
@modal.asgi_app()
def web():
    from app.main import app as api  # the FastAPI instance

    return api
