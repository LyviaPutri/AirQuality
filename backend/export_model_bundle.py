"""Ekspor model_pm25.joblib -> folder model_bundle/ (format native XGBoost, tanpa pickle).

Jalankan SEKALI di lingkungan yang bisa memuat model_pm25.joblib (mis. Colab/notebook
setelah training):  python export_model_bundle.py

Hasil:
  model_bundle/reg_h{1,2,3}.ubj   regresi PM2.5 per horizon
  model_bundle/cls_h{1,2,3}.ubj   klasifikasi peluang PM2.5 > 35 per horizon
  model_bundle/calibrator.json    kalibrasi isotonic (array threshold)
  model_bundle/meta.json          fitur per horizon, kolom input, ambang alarm, dll.
"""
import json
import os
import sys

import joblib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fitur  # noqa: F401  (Kalibrator harus bisa di-import saat joblib.load)

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "model_bundle")
os.makedirs(OUT, exist_ok=True)

paket = joblib.load(os.path.join(BASE, "model_pm25.joblib"))
meta = paket["meta"]
horizons = [int(h) for h in meta["horizons"]]

for h in horizons:
    paket["reg_models"][h].get_booster().save_model(os.path.join(OUT, f"reg_h{h}.ubj"))
    paket["cls_models"][h].get_booster().save_model(os.path.join(OUT, f"cls_h{h}.ubj"))

kalibrator = {}
for h in horizons:
    iso = paket["cls_cal"][h].m
    kalibrator[str(h)] = {
        "x": [float(v) for v in iso.X_thresholds_],
        "y": [float(v) for v in iso.y_thresholds_],
        "x_min": float(iso.X_min_),
        "x_max": float(iso.X_max_),
    }
with open(os.path.join(OUT, "calibrator.json"), "w") as f:
    json.dump(kalibrator, f)

meta_min = {
    "horizons": horizons,
    "features_per_horizon": {str(h): list(meta["features_per_horizon"][h]) for h in horizons},
    "kolom_input": list(meta["kolom_input"]),
    "pakai_cuaca": bool(meta["pakai_cuaca"]),
    "ambang_alarm_prob": {str(h): float(meta["ambang_alarm_prob"][h]) for h in horizons},
    "thr_waspada": float(meta["thr_waspada"]),
    "min_riwayat": int(meta["min_riwayat"]),
}
with open(os.path.join(OUT, "meta.json"), "w") as f:
    json.dump(meta_min, f, indent=1)

print("Selesai ->", OUT, sorted(os.listdir(OUT)))
