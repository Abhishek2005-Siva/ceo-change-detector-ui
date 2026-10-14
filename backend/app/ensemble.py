"""The deployed best model: a mixed ensemble of three LoRA-tuned readers
(RoBERTa-large x2 + DeBERTa-v3-base x1). A reader's vote only counts when its own
confidence is >= THRESHOLD, and a class is flagged when >= 2 of 3 readers agree.
Same decision logic as the evaluation run that scored 0.8673 overall F1.
"""
import json
import os
from typing import Callable, Dict, List, Optional

import torch
from huggingface_hub import snapshot_download
from peft import PeftModel
from transformers import AutoModelForSequenceClassification, AutoTokenizer

import re

from .item502 import regex_extract_ceo_event

_HONORIFIC_SURNAME = re.compile(r"\b(?:Mr|Ms|Mrs|Dr)\.\s+([A-Z][A-Za-z'\-]+)")

LABELS = ["NONE", "APPOINTED", "RESIGNED"]
ID2LABEL = {i: l for i, l in enumerate(LABELS)}
LABEL2ID = {l: i for i, l in ID2LABEL.items()}
THRESHOLD = 0.7
MAX_LENGTH = 320
BATCH = 8

READER_NAMES = {
    "robertalarge_seed7": "Reader A · RoBERTa-large",
    "robertalarge_seed123": "Reader B · RoBERTa-large",
    "deberta_seed42": "Reader C · DeBERTa-v3",
}


class Ensemble:
    def __init__(self) -> None:
        torch.set_num_threads(int(os.getenv("TORCH_THREADS", "4")))
        repo = os.environ["MODEL_REPO"]
        local = snapshot_download(repo_id=repo, token=os.getenv("HF_TOKEN"))
        order = list(READER_NAMES)
        dirs = sorted(
            (
                os.path.join(local, d)
                for d in os.listdir(local)
                if os.path.exists(os.path.join(local, d, "adapter_config.json"))
            ),
            key=lambda p: order.index(os.path.basename(p)) if os.path.basename(p) in order else 99,
        )
        if len(dirs) != 3:
            raise RuntimeError(f"Expected 3 reader folders in the model repo, found {len(dirs)}")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.readers = []
        for d in dirs:
            with open(os.path.join(d, "adapter_config.json")) as f:
                base = json.load(f)["base_model_name_or_path"]
            tok = AutoTokenizer.from_pretrained(d)
            model = AutoModelForSequenceClassification.from_pretrained(
                base, num_labels=len(LABELS), id2label=ID2LABEL, label2id=LABEL2ID
            )
            model = PeftModel.from_pretrained(model, d)
            model.eval().to(self.device)
            name = READER_NAMES.get(os.path.basename(d), os.path.basename(d))
            self.readers.append((name, tok, model))

    @property
    def reader_names(self) -> List[str]:
        return [r[0] for r in self.readers]

    def _probs(self, sentences: List[str], tok, model) -> List[List[float]]:
        out: List[List[float]] = []
        for i in range(0, len(sentences), BATCH):
            batch = sentences[i : i + BATCH]
            enc = tok(batch, truncation=True, max_length=MAX_LENGTH, padding=True, return_tensors="pt")
            enc = {k: v.to(self.device) for k, v in enc.items()}
            with torch.no_grad():
                logits = model(**enc).logits
            out.extend(torch.softmax(logits, dim=-1).tolist())
        return out

    def analyze(self, sentences: List[str], on_reader_done: Optional[Callable[[int, int], None]] = None) -> Dict:
        per_reader = []
        for idx, (name, tok, model) in enumerate(self.readers):
            probs = self._probs(sentences, tok, model)
            per_reader.append(probs)
            if on_reader_done:
                on_reader_done(idx + 1, len(self.readers))

        # sentence-level view: what each reader thought of each sentence
        sent_rows = []
        for s_i, sentence in enumerate(sentences):
            readers = []
            for r_i, (name, _, _) in enumerate(self.readers):
                p = per_reader[r_i][s_i]
                top = max(range(3), key=lambda k: p[k])
                readers.append({
                    "reader": name,
                    "label": LABELS[top],
                    "confidence": round(p[top], 4),
                    "counts": top != 0 and p[top] >= THRESHOLD,
                })
            sent_rows.append({"text": sentence, "readers": readers})

        # filing-level decision (identical logic to the evaluation pipeline)
        def best_for(label: str, r_i: int):
            best = None
            for s_i, sentence in enumerate(sentences):
                p = per_reader[r_i][s_i]
                top = max(range(3), key=lambda k: p[k])
                if LABELS[top] == label and p[top] >= THRESHOLD and (best is None or p[top] > best[1]):
                    best = (s_i, p[top])
            return best

        result = {}
        for label, key, kind in (("APPOINTED", "appointed", "appointed"), ("RESIGNED", "resigned", "resigned")):
            votes = [best_for(label, r) for r in range(len(self.readers))]
            agreeing = [v for v in votes if v is not None]
            flagged = len(agreeing) >= len(self.readers) // 2 + 1
            best = max(agreeing, key=lambda v: v[1]) if flagged else None
            sentence = sentences[best[0]] if best else ""
            name = ""
            if best:
                ev = regex_extract_ceo_event(sentence)
                if ev and ev[1] == kind:
                    name = ev[0]
                else:
                    for s in sentences:
                        ev = regex_extract_ceo_event(s)
                        if ev and ev[1] == kind:
                            name = ev[0]
                            break
            if best and not name:
                m = _HONORIFIC_SURNAME.search(sentence)
                if m:
                    name = m.group(0)  # e.g. "Mr. Janik": the filing only gives the surname here
            result[key] = {
                "found": flagged,
                "name": name,
                "sentence": sentence,
                "sentenceIndex": best[0] if best else None,
                "confidence": round(best[1], 4) if best else None,
                "votesFor": len(agreeing),
                "readers": [
                    {
                        "reader": self.readers[r][0],
                        "voted": votes[r] is not None,
                        "confidence": round(votes[r][1], 4) if votes[r] else None,
                    }
                    for r in range(len(self.readers))
                ],
            }
        return {"sentences": sent_rows, **result}
