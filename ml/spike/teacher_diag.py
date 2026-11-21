import json, random, torch, numpy as np
from pathlib import Path
from sklearn.metrics import roc_auc_score
import athena_ml.teacher as T
random.seed(7)
def read(p, n):
    rows=[]
    for l in open(p):
        try: rows.append(json.loads(l))
        except json.JSONDecodeError: pass
    random.shuffle(rows); return rows[:n]
raw=Path("data/raw")
human=[r for p in sorted(raw.glob("human-*.jsonl")) for r in read(p,25)][:300]
ai=read(raw/"ai.jsonl",300)
codes=[r["code"] for r in human]+[r["code"] for r in ai]; y=np.array([0]*len(human)+[1]*len(ai))
m,tok=T.load_teacher()
lg=T.label(m,tok,codes)
pr=torch.softmax(lg,-1).numpy()
print("mean probs human-set",pr[:len(human)].mean(0).round(3),"ai-set",pr[len(human):].mean(0).round(3))
for name,s in [("1-P(human)",1-pr[:,0]),("P(machine)",pr[:,1]),("P(adv)",pr[:,3]),("P(machine+adv)",pr[:,1]+pr[:,3])]:
    print(name,"AUC",round(roc_auc_score(y,s),3))
# unmasked mean variant (padding counted, as in the README forward)
@torch.no_grad()
def label_unmasked(codes,bs=16):
    out=[]
    order=sorted(range(len(codes)),key=lambda i:len(codes[i])); res=torch.zeros(len(codes),4)
    for s in range(0,len(order),bs):
        idx=order[s:s+bs]; enc=tok([codes[i] for i in idx],truncation=True,max_length=512,padding=True,return_tensors="pt").to("mps")
        h=m.text_encoder(input_ids=enc["input_ids"],attention_mask=enc["attention_mask"]).last_hidden_state.mean(1)
        res[idx]=m.classifier(torch.relu(m.text_projection(h))).float().cpu()
    return res
pr2=torch.softmax(label_unmasked(codes),-1).numpy()
print("unmasked 1-P(human) AUC",round(roc_auc_score(y,1-pr2[:,0]),3),"P(machine) AUC",round(roc_auc_score(y,pr2[:,1]),3))
