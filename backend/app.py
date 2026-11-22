# TODO Import library
import io
import json
import os
import traceback

import joblib
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS

# Kalibrator wajib di-import agar joblib dapat memuat model_pm25.joblib (jalur cadangan)
from fitur import CUACA, POLUTAN, Kalibrator, buat_fitur  # noqa: F401

# TODO  Inisialisasi aplikasi Flask
app = Flask(__name__)

CORS(app)

# TODO Konfigurasi path model machine learning
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BUNDLE_DIR = os.path.join(BASE_DIR, "model_bundle")          # jalur utama (format native XGBoost)
MODEL_FILENAME = "model_pm25.joblib"
MODEL_PATH = os.path.join(BASE_DIR, MODEL_FILENAME)          # jalur cadangan (pickle joblib)
AMBANG_WASPADA = 35.0

KOLOM_ALIAS = {
    "time": "time",
    "pm10": "pm10",
    "pm10 (μg/m³)": "pm10",
    "pm10 (µg/m³)": "pm10",
    "pm2_5": "pm2_5",
    "pm2.5": "pm2_5",
    "pm2_5 (μg/m³)": "pm2_5",
    "pm2_5 (µg/m³)": "pm2_5",
    "co": "co",
    "carbon_monoxide": "co",
    "carbon_monoxide (μg/m³)": "co",
    "carbon_monoxide (µg/m³)": "co",
    "no2": "no2",
    "nitrogen_dioxide": "no2",
    "nitrogen_dioxide (μg/m³)": "no2",
    "nitrogen_dioxide (µg/m³)": "no2",
    "so2": "so2",
    "sulphur_dioxide": "so2",
    "sulfur_dioxide": "so2",
    "sulphur_dioxide (μg/m³)": "so2",
    "sulphur_dioxide (µg/m³)": "so2",
    "o3": "o3",
    "ozone": "o3",
    "ozone (μg/m³)": "o3",
    "ozone (µg/m³)": "o3",
    "temp": "temp",
    "suhu": "temp",
    "temperature_2m": "temp",
    "temperature_2m (°c)": "temp",
    "rh": "rh",
    "kelembapan": "rh",
    "relative_humidity_2m": "rh",
    "relative_humidity_2m (%)": "rh",
    "hujan": "hujan",
    "rain": "hujan",
    "precipitation": "hujan",
    "rain (mm)": "hujan",
    "precipitation (mm)": "hujan",
    "angin": "angin",
    "wind_speed_10m": "angin",
    "wind_speed_10m (km/h)": "angin",
    "wind_speed_10m (m/s)": "angin",
    "arah_angin": "arah_angin",
    "wind_direction_10m": "arah_angin",
    "wind_direction_10m (°)": "arah_angin",
    "tekanan": "tekanan",
    "pressure_msl": "tekanan",
    "surface_pressure": "tekanan",
    "pressure_msl (hpa)": "tekanan",
    "surface_pressure (hpa)": "tekanan",
}


class ModelPM25:
    """Pembungkus model: nilai PM2.5 (regresi) dan peluang waspada terkalibrasi per horizon."""

    def __init__(self, meta, fn_nilai, fn_peluang, sumber):
        self.horizons = [int(h) for h in meta["horizons"]]
        self.fitur = {int(h): list(v) for h, v in meta["features_per_horizon"].items()}
        self.kolom_input = list(meta["kolom_input"])
        self.pakai_cuaca = bool(meta["pakai_cuaca"])
        self.ambang_alarm = {int(h): float(v) for h, v in meta["ambang_alarm_prob"].items()}
        self.min_riwayat = int(meta["min_riwayat"])
        self.nilai = fn_nilai        # nilai(h, X) -> float (ug/m3)
        self.peluang = fn_peluang    # peluang(h, X) -> float 0..1 (terkalibrasi)
        self.sumber = sumber


def _muat_bundle():
    """Jalur utama: file native .ubj + JSON. Tidak memakai pickle sama sekali."""
    import xgboost as xgb

    with open(os.path.join(BUNDLE_DIR, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    with open(os.path.join(BUNDLE_DIR, "calibrator.json"), encoding="utf-8") as f:
        kal = json.load(f)

    reg, cls = {}, {}
    for h in meta["horizons"]:
        b_reg, b_cls = xgb.Booster(), xgb.Booster()
        b_reg.load_model(os.path.join(BUNDLE_DIR, f"reg_h{h}.ubj"))
        b_cls.load_model(os.path.join(BUNDLE_DIR, f"cls_h{h}.ubj"))
        reg[int(h)], cls[int(h)] = b_reg, b_cls

    def dmat(h, X):
        cols = meta["features_per_horizon"][str(h)]
        return xgb.DMatrix(X[cols].astype(float), feature_names=cols)

    def nilai(h, X):
        return float(reg[h].predict(dmat(h, X))[0])

    def peluang(h, X):
        p = float(cls[h].predict(dmat(h, X))[0])
        k = kal[str(h)]
        return float(np.interp(np.clip(p, k["x_min"], k["x_max"]), k["x"], k["y"]))

    return ModelPM25(meta, nilai, peluang, "model_bundle (native XGBoost)")


def _muat_joblib():
    """Jalur cadangan: model_pm25.joblib dari notebook (reg_models, cls_models, cls_cal, meta)."""
    paket = joblib.load(MODEL_PATH)
    meta = paket["meta"]
    fitur = {int(h): list(v) for h, v in meta["features_per_horizon"].items()}

    def nilai(h, X):
        return float(paket["reg_models"][h].predict(X[fitur[h]])[0])

    def peluang(h, X):
        p = paket["cls_models"][h].predict_proba(X[fitur[h]])[:, 1]
        return float(paket["cls_cal"][h].predict(p)[0])

    return ModelPM25(meta, nilai, peluang, MODEL_FILENAME)


def load_model():
    galat = []
    if os.path.isdir(BUNDLE_DIR):
        try:
            return _muat_bundle()
        except Exception as err:
            traceback.print_exc()
            galat.append(f"model_bundle: {type(err).__name__}: {err}")
    if os.path.exists(MODEL_PATH):
        try:
            return _muat_joblib()
        except Exception as err:
            traceback.print_exc()
            galat.append(f"{MODEL_FILENAME}: {type(err).__name__}: {err}")
    else:
        galat.append(f"{MODEL_FILENAME} tidak ditemukan di {BASE_DIR}")
    raise RuntimeError(" | ".join(galat))


# Model dimuat sekali. Jika gagal, server TETAP hidup supaya /health dan /predict
# memberi pesan yang jelas (bukan proses mati -> frontend hanya melihat "tidak tersedia").
MODEL = None
MODEL_ERROR = None
try:
    MODEL = load_model()
    print(f"[OK] Model dimuat dari: {MODEL.sumber}")
except Exception as err:
    MODEL_ERROR = str(err)
    print(f"[ERROR] Model gagal dimuat: {MODEL_ERROR}")


def normalisasi_nama_kolom(col: str) -> str:
    bersih = " ".join(str(col).strip().lower().split())
    return KOLOM_ALIAS.get(bersih, bersih)


def baca_csv_open_meteo(file_storage) -> pd.DataFrame:
    konten = file_storage.read().decode("utf-8-sig", errors="replace")
    baris = konten.splitlines()

    idx_header = 0
    for i, line in enumerate(baris[:15]):
        kolom_cek = [normalisasi_nama_kolom(k) for k in line.split(",")]
        if "time" in kolom_cek and len(kolom_cek) >= 2:
            idx_header = i
            break

    df = pd.read_csv(io.StringIO("\n".join(baris[idx_header:])))
    df.columns = [normalisasi_nama_kolom(c) for c in df.columns]

    if "time" not in df.columns:
        raise ValueError("Kolom 'time' tidak ditemukan pada CSV.")

    df["time"] = pd.to_datetime(df["time"], errors="coerce")
    df = df.dropna(subset=["time"]).sort_values("time").drop_duplicates(subset=["time"], keep="last")

    for c in df.columns:
        if c != "time":
            df[c] = pd.to_numeric(df[c], errors="coerce")

    return df.reset_index(drop=True)


def gabungkan_csv(df_polutan: pd.DataFrame, df_cuaca: pd.DataFrame) -> pd.DataFrame:
    df = pd.merge(df_polutan, df_cuaca, on="time", how="inner", suffixes=("", "_cuaca"))
    df = df.sort_values("time").drop_duplicates(subset=["time"], keep="last").reset_index(drop=True)

    for c in list(df.columns):
        if c.endswith("_cuaca"):
            utama = c[: -len("_cuaca")]
            if utama not in df.columns:
                df[utama] = df[c]
            else:
                df[utama] = df[utama].combine_first(df[c])
            df = df.drop(columns=[c])

    wajib = POLUTAN + CUACA
    kurang = [k for k in wajib if k not in df.columns]
    if kurang:
        raise ValueError(f"Kolom kurang: {', '.join(kurang)}")

    df[wajib] = df[wajib].interpolate(method="linear", limit_direction="both")
    return df


def kategori_kualitas(nilai: float) -> str:
    if nilai <= 15.5:
        return "Baik"
    if nilai <= 55.4:
        return "Sedang"
    if nilai <= 150.4:
        return "Tidak Sehat"
    if nilai <= 250.4:
        return "Sangat Tidak Sehat"
    return "Berbahaya"


@app.route("/health", methods=["GET"])
def health():
    if MODEL is None:
        return jsonify({"status": "error", "model_loaded": False, "error": MODEL_ERROR}), 503
    return jsonify({"status": "ok", "model_loaded": True, "sumber": MODEL.sumber,
                    "horizons": MODEL.horizons}), 200


@app.route("/predict", methods=["POST"])
def predict():
    if MODEL is None:
        return jsonify({
            "success": False,
            "error": "Model peramalan belum berhasil dimuat di server. Periksa log terminal backend.",
        }), 503

    file_polutan = request.files.get("file_polutan")
    file_cuaca = request.files.get("file_cuaca")

    if not file_polutan or not file_cuaca:
        return jsonify({
            "success": False,
            "error": "Unggah kedua file CSV (Polutan dan Cuaca) terlebih dahulu.",
        }), 400

    try:
        df_polutan = baca_csv_open_meteo(file_polutan)
        df_cuaca = baca_csv_open_meteo(file_cuaca)

        df_gabung = gabungkan_csv(df_polutan, df_cuaca)
        if len(df_gabung) < MODEL.min_riwayat:
            return jsonify({
                "success": False,
                "error": f"Riwayat gabungan kurang dari {MODEL.min_riwayat} jam.",
            }), 400

        df_idx = df_gabung.set_index("time")

        # Lag/rolling pada model mengasumsikan baris per jam berurutan tanpa celah
        selisih = df_idx.index[-MODEL.min_riwayat:].to_series().diff().dropna()
        if not selisih.eq(pd.Timedelta(hours=1)).all():
            return jsonify({
                "success": False,
                "error": f"Data harus per jam tanpa jam yang hilang pada {MODEL.min_riwayat} jam terakhir.",
            }), 400

        fitur_all = buat_fitur(df_idx, cuaca=MODEL.pakai_cuaca)
        baris_terakhir = fitur_all.iloc[[-1]]      # fitur untuk jam terbaru (t)
        dipakai = sorted({c for h in MODEL.horizons for c in MODEL.fitur[h]})
        if baris_terakhir[dipakai].isna().any().any():
            return jsonify({
                "success": False,
                "error": "Fitur belum mencukupi: ada nilai kosong pada data jam terakhir.",
            }), 400

        current_pm25 = round(float(df_idx["pm2_5"].iloc[-1]), 1)

        predictions_list = []
        predictions_dict = {}

        for h in MODEL.horizons:
            nilai_pred = round(max(0.0, MODEL.nilai(h, baris_terakhir)), 1)
            peluang = MODEL.peluang(h, baris_terakhir)
            alarm = bool(peluang >= MODEL.ambang_alarm[h])
            kat = kategori_kualitas(nilai_pred)
            rekom = (
                "Masyarakat diimbau membatasi aktivitas luar ruang dan memakai masker."
                if alarm
                else "Aktivitas luar ruang aman dilakukan seperti biasa."
            )
            prob_persen = round(peluang * 100, 1)

            predictions_list.append({
                "hour": int(h),
                "value": nilai_pred,
                "kategori": kat,
                "alarm_waspada": alarm,
                "probabilitas_waspada": prob_persen,
                "rekomendasi": rekom,
            })
            predictions_dict[f"t+{int(h)}h"] = {
                "horizon_jam": int(h),
                "prediksi_pm25": nilai_pred,
                "kategori": kat,
                "alarm_waspada": alarm,
                "probabilitas_waspada": prob_persen,
                "rekomendasi": rekom,
            }

        # TODO return respons jsonify
        return jsonify({
            "success": True,
            "current_pm25": current_pm25,
            "predictions": predictions_list,
            "predictions_by_horizon": predictions_dict,
        }), 200

    except ValueError as err:
        return jsonify({"success": False, "error": str(err)}), 400
    except Exception:
        traceback.print_exc()   # traceback lengkap di terminal backend
        return jsonify({
            "success": False,
            "error": "Terjadi kesalahan internal saat memproses peramalan. Periksa log terminal backend.",
        }), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
