FROM python:3.11-slim

RUN useradd -m -u 1000 user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1
WORKDIR /home/user/app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
USER user

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu torch \
 && pip install --no-cache-dir -r requirements.txt

# Public base models are baked into the image so restarts are fast.
# The private fine-tuned adapters are NOT here: they are fetched at startup from a private model repo.
RUN python -c "from huggingface_hub import snapshot_download as s; s('roberta-large', allow_patterns=['*.json','*.safetensors','*.txt']); s('microsoft/deberta-v3-base', allow_patterns=['*.json','*.safetensors','*.txt','*.model'])"

COPY --chown=user app ./app
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
