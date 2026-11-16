import numpy as np
import pandas as pd

HORIZONS = [1, 2, 3, 4, 5, 6]   # jam ke depan
LAGS = [1, 2, 3, 6, 12, 24, 48, 72, 168]
POLUTAN = ['pm10', 'pm2_5', 'co', 'no2', 'so2', 'o3']
CUACA = ['temp', 'rh', 'hujan', 'angin', 'arah_angin', 'tekanan']
CUACA_LAGS = [1, 3, 6, 24]
HUJAN_WINDOW = [6, 24, 72]
MIN_RIWAYAT = 200   # jam riwayat minimal untuk membentuk satu baris fitur


def fitur_polutan(d):
    """89 fitur dari data polutan (hanya memakai informasi sampai jam t)."""
    f = {}
    for c in POLUTAN:
        f[f'{c}_now'] = d[c]
        for l in LAGS:
            f[f'{c}_lag{l}'] = d[c].shift(l)

    pm = d['pm2_5']
    pm_s = pm.shift(1)
    for w in [6, 24, 72, 168]:
        f[f'pm2_5_rmean{w}'] = pm_s.rolling(w).mean()
        f[f'pm2_5_rstd{w}'] = pm_s.rolling(w).std()
    for w in [24, 72]:
        f[f'pm2_5_rmax{w}'] = pm_s.rolling(w).max()
        f[f'pm2_5_rmin{w}'] = pm_s.rolling(w).min()
    for c in ['pm10', 'co', 'no2', 'so2', 'o3']:
        f[f'{c}_rmean24'] = d[c].shift(1).rolling(24).mean()

    for k in [1, 3, 6, 24]:
        f[f'pm2_5_diff{k}'] = pm - pm.shift(k)
    f['pm2_5_ewm6'] = pm_s.ewm(span=6).mean()
    f['pm2_5_ewm24'] = pm_s.ewm(span=24).mean()
    f['pm_ratio'] = pm / (d['pm10'] + 1e-6)

    idx = d.index
    f['hour_sin'] = np.sin(2 * np.pi * idx.hour.values / 24)
    f['hour_cos'] = np.cos(2 * np.pi * idx.hour.values / 24)
    f['month_sin'] = np.sin(2 * np.pi * idx.month.values / 12)
    f['month_cos'] = np.cos(2 * np.pi * idx.month.values / 12)
    f['dayofweek'] = idx.dayofweek.values
    return pd.DataFrame(f, index=d.index)


def fitur_cuaca(d):
    """30 fitur dari data cuaca (hanya memakai informasi sampai jam t)."""
    f = {}
    for c in ['temp', 'rh', 'tekanan', 'angin']:
        f[f'{c}_now'] = d[c]
        for l in CUACA_LAGS:
            f[f'{c}_lag{l}'] = d[c].shift(l)

    # Hujan: akumulasi lebih informatif daripada nilai per jam
    h = d['hujan']
    f['hujan_now'] = h
    for w in HUJAN_WINDOW:
        f[f'hujan_sum{w}'] = h.rolling(w).sum()

    # Arah angin: sin/cos (siklik) dan komponen u, v (dikali kecepatan)
    rad = np.deg2rad(d['arah_angin'])
    f['arah_sin'] = np.sin(rad)
    f['arah_cos'] = np.cos(rad)
    f['wind_u'] = -d['angin'] * np.sin(rad)
    f['wind_v'] = -d['angin'] * np.cos(rad)

    # Tren tekanan
    f['tekanan_diff3'] = d['tekanan'] - d['tekanan'].shift(3)
    f['tekanan_diff24'] = d['tekanan'] - d['tekanan'].shift(24)
    return pd.DataFrame(f, index=d.index)


def buat_fitur(d):
    """Tabel fitur lengkap (119 fitur: 89 polutan + 30 cuaca). Dipakai pelatihan dan dashboard."""
    return pd.concat([fitur_polutan(d), fitur_cuaca(d)], axis=1)


class Kalibrator:
    """Kalibrasi probabilitas dengan isotonic regression. Disimpan di fitur.py agar
    model .joblib bisa dimuat dashboard (joblib perlu menemukan kelas ini)."""
    def fit(self, p, y):
        from sklearn.isotonic import IsotonicRegression
        self.m = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds='clip').fit(
            np.asarray(p, dtype=float), np.asarray(y))
        return self

    def predict(self, p):
        return self.m.predict(np.asarray(p, dtype=float))
