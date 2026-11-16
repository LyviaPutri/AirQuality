import os
import sys
import joblib
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS

# Memastikan direktori backend terbaca untuk mengimpor fitur.py
sys.path.append(os.path.dirname(__file__))
from fitur import buat_fitur, Kalibrator, MIN_RIWAYAT

# Inisialisasi aplikasi Flask
app = Flask(__name__)
CORS(app)

# Konfigurasi nama dan path file model
MODEL_FILENAME = 'model_pm25.joblib'
MODEL_PATH = os.path.join(os.path.dirname(__file__), MODEL_FILENAME)

# Variabel global untuk menyimpan komponen model
reg_models = None
cls_models = None
cls_cal = None
meta_load = None

def load_model():
    global reg_models, cls_models, cls_cal, meta_load
    try:
        if os.path.exists(MODEL_PATH):
            paket = joblib.load(MODEL_PATH)
            reg_models = paket['reg_models']
            cls_models = paket['cls_models']
            cls_cal = paket['cls_cal']
            meta_load = paket['meta']
            print(f"[SUCCESS] Model '{MODEL_FILENAME}' berhasil dimuat.")
            return True
        else:
            print(f"[ERROR] File '{MODEL_FILENAME}' tidak ditemukan di {MODEL_PATH}")
            return False
    except Exception as e:
        print(f"[ERROR] Gagal memuat model '{MODEL_FILENAME}': {e}")
        return False

# Memuat model saat server pertama kali dijalankan
load_model()

@app.route('/', methods=['GET'])
def index():
    return jsonify({
        "status": "online",
        "service": "API Peramalan PM2.5 Kota Padang (Multi-Horizon XGBoost)",
        "model_loaded": reg_models is not None,
        "model_file": MODEL_FILENAME
    })

def kategori_pm25(v):
    """Kategori ISPU PM2.5 (Permen LHK No. 14 Tahun 2020)."""
    if v <= 15.5:  return 'Baik'
    if v <= 55.4:  return 'Sedang'
    if v <= 150.4: return 'Tidak Sehat'
    if v <= 250.4: return 'Sangat Tidak Sehat'
    return 'Berbahaya'

@app.route('/predict', methods=['POST'])
def predict():
    global reg_models, cls_models, cls_cal, meta_load
    
    # Pastikan model sudah termuat di memori
    if reg_models is None:
        success = load_model()
        if not success:
            return jsonify({
                "success": False,
                "error": f"Model '{MODEL_FILENAME}' belum berhasil dimuat. Pastikan file ada di folder backend."
            }), 500

    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({
                "success": False,
                "error": "Tidak ada data JSON yang diterima."
            }), 400

        # Client / Frontend harus mengirimkan riwayat data historis (minimal 200 jam terakhir)
        if 'history' not in data:
            return jsonify({
                "success": False,
                "error": "Kunci 'history' (riwayat data) tidak ditemukan dalam payload JSON."
            }), 400

        riwayat_list = data['history']
        riwayat = pd.DataFrame(riwayat_list)

        # Validasi kolom input yang dibutuhkan oleh model
        kolom_input = meta_load['kolom_input']
        kurang = [c for c in kolom_input if c not in riwayat.columns]
        if kurang:
            return jsonify({
                "success": False,
                "error": f"Kolom input pada riwayat kurang: {kurang}"
            }), 400

        # Validasi panjang riwayat minimum
        if len(riwayat) < meta_load['min_riwayat']:
            return jsonify({
                "success": False,
                "error": f"Riwayat minimal membutuhkan {meta_load['min_riwayat']} jam, data diterima {len(riwayat)} jam."
            }), 400

        # Penanganan indeks waktu
        if 'time' in riwayat.columns:
            riwayat['time'] = pd.to_datetime(riwayat['time'])
            riwayat = riwayat.set_index('time').sort_index()
        else:
            # Jika tidak ada kolom time, buat indeks waktu per jam tiruan
            riwayat.index = pd.date_range(end=pd.Timestamp.now(), periods=len(riwayat), freq='h')

        # Memeriksa nilai kosong pada 200 jam terakhir
        if riwayat[kolom_input].tail(meta_load['min_riwayat']).isna().any().any():
            return jsonify({
                "success": False,
                "error": "Terdapat nilai kosong (NaN) pada 200 jam terakhir data riwayat."
            }), 400

        # Menghitung fitur menggunakan script fitur.py milik Lyvia
        fitur_all = buat_fitur(riwayat).iloc[[-1]]
        
        hasil_prediksi = {}
        for h in meta_load['horizons']:
            x = fitur_all[meta_load['features_per_horizon'][h]]
            
            # Nilai regresi PM2.5 (minimal 0)
            nilai = max(float(reg_models[h].predict(x)[0]), 0.0)
            
            # Probabilitas alarm terkalibrasi
            prob = float(cls_cal[h].predict(cls_models[h].predict_proba(x)[:, 1])[0])
            alarm = prob >= meta_load['ambang_alarm_prob'][h]
            
            k = kategori_pm25(nilai)
            
            hasil_prediksi[f"t+{h}h"] = {
                "horizon_jam": h,
                "prediksi_pm25": round(nilai, 2),
                "kategori": k,
                "probabilitas_waspada": round(prob * 100, 1),
                "alarm_waspada": bool(alarm)
            }

        return jsonify({
            "success": True,
            "predictions": hasil_prediksi
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Terjadi kesalahan saat memproses prediksi: {str(e)}"
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Server Flask berjalan di http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=True)