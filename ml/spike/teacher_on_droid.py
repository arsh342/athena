import json, urllib.request, numpy as np, torch
from sklearn.metrics import roc_auc_score
import athena_ml.teacher as T
rows=[]
for off in range(0,400,100):
    u=f"https://datasets-server.huggingface.co/rows?dataset=project-droid/DroidCollection&config=default&split=test&offset={off}&length=100"
    rows+= [r["row"] for r in json.load(urllib.request.urlopen(u,timeout=60))["rows"]]
rows=[r for r in rows if r["Label"] in ("HUMAN_GENERATED","MACHINE_GENERATED")]
print(len(rows),"rows",sum(r["Label"]=="HUMAN_GENERATED" for r in rows),"human")
m,tok=T.load_teacher()
lg=T.label(m,tok,[r["Code"] for r in rows]); pr=torch.softmax(lg,-1).numpy()
y=np.array([r["Label"]=="MACHINE_GENERATED" for r in rows])
print("AUC 1-P(human):",round(roc_auc_score(y,1-pr[:,0]),3),"| acc@argmax:",round(((pr.argmax(1)!=0)==y).mean(),3))
