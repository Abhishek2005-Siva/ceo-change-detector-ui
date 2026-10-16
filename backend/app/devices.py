"""Chooses where each model lives. CPU by default; with USE_GPU=1 models are spread over the available GPUs
(by free memory) and fall back to CPU when none has room."""
import os

import torch


def place(model, headroom_gb: float = 1.5):
    if os.getenv("USE_GPU", "0") != "1" or not torch.cuda.is_available():
        return model
    gb = sum(p.numel() for p in model.parameters()) * 4 / 1e9
    free = sorted(((torch.cuda.mem_get_info(i)[0] / 1e9, i) for i in range(torch.cuda.device_count())), reverse=True)
    for f, i in free:
        if f > gb + headroom_gb:
            return model.to(f"cuda:{i}")
    return model
