"""
DroidDetect-Base as a teacher (Apache-2.0, project-droid; weights pinned by sha in the spike report).

The repository ships only weights, so the model is rebuilt from the README: ModernBERT-base encoder, mean pooling,
Linear(768->256)+ReLU, Linear(256->4). Classes: 0 human, 1 machine, 2 machine-refined, 3 machine-adversarial.
P(ai) = 1 - P(human). Weights are loaded with weights_only=True (they are a pickle).
"""
from __future__ import annotations

from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import AutoTokenizer, ModernBertConfig, ModernBertModel

TEACHER_DIR = Path(__file__).resolve().parent.parent / "data" / "teacher"


class Teacher(nn.Module):
    def __init__(self, cfg: ModernBertConfig):
        super().__init__()
        self.text_encoder = ModernBertModel(cfg)
        self.text_projection = nn.Linear(768, 256)
        self.classifier = nn.Linear(256, 4)

    def forward(self, input_ids, attention_mask):
        h = self.text_encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        m = attention_mask.unsqueeze(-1).to(h.dtype)
        pooled = (h * m).sum(1) / m.sum(1).clamp(min=1)
        return self.classifier(F.relu(self.text_projection(pooled)))


def load_teacher(device: str = "mps") -> tuple[Teacher, object]:
    cfg = ModernBertConfig.from_json_file(str(TEACHER_DIR / "modernbert_config.json"))
    model = Teacher(cfg)
    sd = torch.load(TEACHER_DIR / "pytorch_model.bin", map_location="cpu", weights_only=True)
    missing, unexpected = model.load_state_dict(sd, strict=False)
    real_missing = [k for k in missing if "rotary" not in k]
    if real_missing or unexpected:
        raise RuntimeError(f"teacher weights do not match: missing={real_missing[:5]} unexpected={unexpected[:5]}")
    tok = AutoTokenizer.from_pretrained(str(TEACHER_DIR))
    return model.eval().to(device), tok


@torch.no_grad()
def label(model: Teacher, tok, codes: list[str], device: str = "mps", max_len: int = 512, batch: int = 16) -> torch.Tensor:
    """Teacher logits (n, 4), in input order. Sorted by length internally so padding stays small."""
    order = sorted(range(len(codes)), key=lambda i: len(codes[i]))
    out = torch.zeros(len(codes), 4)
    for s in range(0, len(order), batch):
        idx = order[s:s + batch]
        enc = tok([codes[i] for i in idx], truncation=True, max_length=max_len, padding=True, return_tensors="pt").to(device)
        out[idx] = model(enc["input_ids"], enc["attention_mask"]).float().cpu()
    return out
