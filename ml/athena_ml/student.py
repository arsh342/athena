"""Small ModernBERT-style student: 6 layers, hidden 384, 6 heads, the ModernBERT tokenizer, binary head (P(ai))."""
from __future__ import annotations

import torch
import torch.nn as nn
from transformers import ModernBertConfig, ModernBertModel

from .teacher import TEACHER_DIR


def student_config() -> ModernBertConfig:
    cfg = ModernBertConfig.from_json_file(str(TEACHER_DIR / "modernbert_config.json"))
    cfg.hidden_size, cfg.num_hidden_layers, cfg.num_attention_heads = 384, 6, 6
    cfg.intermediate_size = 768
    cfg.global_attn_every_n_layers = 3
    cfg.max_position_embeddings = 512
    cfg._attn_implementation = "sdpa"
    return cfg


class Student(nn.Module):
    def __init__(self, cfg: ModernBertConfig | None = None):
        super().__init__()
        self.encoder = ModernBertModel(cfg or student_config())
        self.head = nn.Sequential(nn.Linear(384, 192), nn.GELU(), nn.Linear(192, 1))

    def forward(self, input_ids, attention_mask):
        h = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        m = attention_mask.unsqueeze(-1).to(h.dtype)
        return self.head((h * m).sum(1) / m.sum(1).clamp(min=1)).squeeze(-1)  # logit of P(ai)
