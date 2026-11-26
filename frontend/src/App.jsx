import React, { useState, useEffect } from 'react';
import {
  BarChart2,
  User,
  CloudUpload,
  CheckCircle,
  Info,
  AlertTriangle,
  Download,
  X,
} from 'lucide-react';
import './App.css';

// URL API Flask Backend
const API_URL = 'http://127.0.0.1:5000/predict';
// Ambang peringatan dini internal sesuai Progress Report 2 (35 µg/m³)
const DANGER_THRESHOLD = 35;

// Data default fallback sebelum backend mengembalikan hasil baru
const INITIAL_PREVIEW_DATA = {
  current_pm25: 24,
  predictions: [
    { hour: 1, value: 31, kategori: 'Sedang', alarm: false, probabilitas: null, rekomendasi: null },
    { hour: 2, value: 39, kategori: 'Sedang', alarm: true, probabilitas: null, rekomendasi: null },
    { hour: 3, value: 48, kategori: 'Sedang', alarm: true, probabilitas: null, rekomendasi: null },
  ],
};

function getFallbackCategory(val) {
  if (val <= 15.5) return 'Baik';
  if (val <= 55.4) return 'Sedang';
  if (val <= 150.4) return 'Tidak Sehat';
  if (val <= 250.4) return 'Sangat Tidak Sehat';
  return 'Berbahaya';
}

function formatTanggalJamWIB(dateObj, shortMonth = false) {
  const tanggal = dateObj.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: shortMonth ? 'short' : 'long',
    year: 'numeric',
  });
  const jam = String(dateObj.getHours()).padStart(2, '0');
  const menit = String(dateObj.getMinutes()).padStart(2, '0');
  return `${tanggal}, ${jam}.${menit} WIB`;
}

// Ekstrak seluruh nilai kolom 'time' dari file CSV Open-Meteo
async function extractTimestampsFromCsv(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  let timeColIdx = -1;

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cols = lines[i]
      .split(',')
      .map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
    const idx = cols.indexOf('time');
    if (idx !== -1 && cols.length >= 2) {
      headerIdx = i;
      timeColIdx = idx;
      break;
    }
  }

  const times = new Set();
  if (headerIdx === -1) return times;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    const rawTime = cols[timeColIdx]?.trim().replace(/^"|"$/g, '');
    if (rawTime) {
      times.add(rawTime.replace(' ', 'T'));
    }
  }
  return times;
}

// Cari timestamp terbaru yang cocok (irisan) di kedua CSV sebagai titik acuan (t0)
async function getLatestMatchedDate(filePolutan, fileCuaca) {
  try {
    const [timesPolutan, timesCuaca] = await Promise.all([
      extractTimestampsFromCsv(filePolutan),
      extractTimestampsFromCsv(fileCuaca),
    ]);
    const matched = [...timesPolutan].filter((t) => timesCuaca.has(t));
    if (matched.length === 0) return null;

    matched.sort();
    const latestIso = matched[matched.length - 1]; // contoh: "2026-07-11T15:00"
    const [datePart, timePart = '00:00'] = latestIso.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);

    if (!year || !month || !day || Number.isNaN(hour)) return null;
    return new Date(year, month - 1, day, hour, minute || 0, 0);
  } catch {
    return null;
  }
}

function parsePredictionsFromBackend(rawPredictions) {
  if (Array.isArray(rawPredictions) && rawPredictions.length > 0) {
    return rawPredictions.slice(0, 3).map((item, idx) => {
      const hour = Number(item.hour ?? item.horizon_jam ?? idx + 1);
      const rawVal = item.value ?? item.prediksi_pm25 ?? 0;
      return {
        hour,
        value: Number(rawVal),
        kategori: item.kategori ?? null,
        alarm: item.alarm_waspada ?? null,
        probabilitas: item.probabilitas_waspada ?? null,
        rekomendasi: item.rekomendasi ?? null,
      };
    });
  }

  if (rawPredictions && typeof rawPredictions === 'object') {
    const list = [1, 2, 3]
      .map((h) => {
        const entry = rawPredictions[`t+${h}h`];
        if (!entry) return null;
        const val = typeof entry === 'number' ? entry : entry.prediksi_pm25 ?? entry.value;
        if (val === undefined || val === null || Number.isNaN(Number(val))) return null;
        return {
          hour: h,
          value: Number(val),
          kategori: typeof entry === 'object' ? entry.kategori ?? null : null,
          alarm: typeof entry === 'object' ? entry.alarm_waspada ?? null : null,
          probabilitas: typeof entry === 'object' ? entry.probabilitas_waspada ?? null : null,
          rekomendasi: typeof entry === 'object' ? entry.rekomendasi ?? null : null,
        };
      })
      .filter(Boolean);

    if (list.length > 0) {
      return list;
    }
  }

  return null;
}

function App() {
  // Deklarasi state awal
  const [polutanFile, setPolutanFile] = useState(null);
  const [cuacaFile, setCuacaFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentDate, setCurrentDate] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [forecastData, setForecastData] = useState(INITIAL_PREVIEW_DATA);
  const [referenceDate, setReferenceDate] = useState(null);
  const [hasPredicted, setHasPredicted] = useState(false);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentDate(
        now.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      );
      setCurrentTime(now.toLocaleTimeString('id-ID'));
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Validasi dan simpan file CSV
  const handleFileSelect = (e, setter) => {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!picked) return;

    if (!picked.name.toLowerCase().endsWith('.csv')) {
      setError('Format file tidak didukung. Harap unggah file berformat .csv.');
      return;
    }

    setError(null);
    setter(picked);
  };

  // Fungsi handlePredict untuk mengirim file CSV ke backend dan menerima hasil prediksi
  const handlePredict = async () => {
    if (!polutanFile || !cuacaFile) {
      setError('Silakan unggah kedua file CSV (Polutan dan Cuaca) terlebih dahulu.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('file_polutan', polutanFile);
      formData.append('file_cuaca', cuacaFile);

      const [response, matchedRefDate] = await Promise.all([
        fetch(API_URL, {
          method: 'POST',
          body: formData,
        }),
        getLatestMatchedDate(polutanFile, cuacaFile),
      ]);

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok || !data || data.success === false) {
        console.error('Backend /predict gagal:', response.status, data);
        setError(
          data?.error ||
            data?.message ||
            `Server peramalan mengembalikan respons tidak valid (HTTP ${response.status}). Periksa log terminal backend.`
        );
        return;
      }

      const normalized = parsePredictionsFromBackend(data.predictions);
      if (normalized && normalized.length > 0) {
        const nextCurrent =
          data.current_pm25 !== undefined && data.current_pm25 !== null
            ? Number(data.current_pm25)
            : forecastData.current_pm25;

        setForecastData({
          current_pm25: Number.isNaN(nextCurrent) ? forecastData.current_pm25 : nextCurrent,
          predictions: normalized,
        });
        setReferenceDate(matchedRefDate);
        setHasPredicted(true);
      } else {
        setError('Format hasil prediksi dari server belum sesuai. Silakan coba lagi.');
      }
    } catch (err) {
      console.error('Gagal menghubungi endpoint /predict:', err);
      setError(
        'Tidak dapat terhubung ke server peramalan (127.0.0.1:5000). Pastikan backend sudah berjalan (python app.py).'
      );
    } finally {
      setLoading(false);
    }
  };

  // Hitung ringkasan otomatis dari seluruh horizon (1 jam s.d. 3 jam ke depan)
  const predictions = forecastData.predictions;
  const currentPm25 = forecastData.current_pm25;
  const peakItem = predictions.reduce(
    (max, item) => (item.value > max.value ? item : max),
    predictions[0]
  );
  const isDanger = peakItem.alarm ?? peakItem.value >= DANGER_THRESHOLD;
  const statusLabel = peakItem.kategori ?? getFallbackCategory(peakItem.value);
  const recommendationText =
    peakItem.rekomendasi ??
    (isDanger
      ? 'Masyarakat diimbau membatasi aktivitas luar ruang dan memakai masker.'
      : 'Aktivitas luar ruang aman dilakukan seperti biasa.');

  const wrapCanvasText = (ctx, text, x, y, maxWidth, lineHeight) => {
    const words = text.split(' ');
    let line = '';
    let currentY = y;
    for (let n = 0; n < words.length; n++) {
      const testLine = `${line + words[n]} `;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line.trim(), x, currentY);
        line = `${words[n]} `;
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    if (line.trim()) {
      ctx.fillText(line.trim(), x, currentY);
      currentY += lineHeight;
    }
    return currentY;
  };

  // Menggambar poster (kanvas 800x1000) memakai waktu acuan dari CSV
  const buatCanvasPoster = (scale = 1) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800 * scale;
    canvas.height = 1000 * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scale, scale);

    const baseTime = referenceDate ?? new Date();
    const currentAcuanStr = formatTanggalJamWIB(baseTime, true);
    const targetDate = new Date(baseTime.getTime() + Number(peakItem.hour) * 3600 * 1000);
    const targetJamStr = formatTanggalJamWIB(targetDate, true);

    ctx.fillStyle = '#fcf8f7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = isDanger ? '#b91c1c' : '#2563eb';
    ctx.fillRect(0, 0, canvas.width, 18);

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('DLH KOTA PADANG', 70, 95);

    ctx.fillStyle = isDanger ? '#b91c1c' : '#1d4ed8';
    ctx.font = 'bold 48px sans-serif';
    const headline = isDanger
      ? 'WASPADA LONJAKAN POLUSI UDARA'
      : `STATUS KUALITAS UDARA: ${statusLabel.toUpperCase()}`;
    const afterTitleY = wrapCanvasText(ctx, headline, 70, 205, 660, 58);

    ctx.fillStyle = '#334155';
    ctx.font = '22px sans-serif';
    const afterTimeY = wrapCanvasText(
      ctx,
      `Acuan Data: ${currentAcuanStr} • Target (${peakItem.hour} jam ke depan): ${targetJamStr}`,
      70,
      afterTitleY + 18,
      660,
      32
    );

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px sans-serif';
    const afterPredY = wrapCanvasText(
      ctx,
      `Prediksi PM2.5: ${peakItem.value} µg/m³ (${statusLabel})`,
      70,
      afterTimeY + 14,
      660,
      36
    );

    const boxY = afterPredY + 30;
    const boxH = 290;
    ctx.fillStyle = isDanger ? '#fbe9ea' : '#eff6ff';
    ctx.fillRect(70, boxY, 660, boxH);

    ctx.fillStyle = isDanger ? '#991b1b' : '#1e40af';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('HIMBAUAN UNTUK MASYARAKAT', 110, boxY + 62);

    ctx.fillStyle = '#1e293b';
    ctx.font = '28px sans-serif';
    wrapCanvasText(ctx, recommendationText, 110, boxY + 120, 580, 42);

    ctx.fillStyle = '#64748b';
    ctx.font = '21px sans-serif';
    ctx.fillText('Dashboard Peringatan Dini PM2.5', 70, 865);
    ctx.fillText('Dinas Lingkungan Hidup Kota Padang', 70, 898);

    return canvas;
  };

  // Unduh poster sebagai file PNG
  const handleDownloadPoster = () => {
    if (!hasPredicted) return;
    const canvas = buatCanvasPoster(1);
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `poster-pm25-dlh-padang-${peakItem.hour}jam.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // Kalkulasi koordinat SVG otomatis
  const maxVal = Math.max(DANGER_THRESHOLD, ...predictions.map((p) => p.value));
  const maxY = Math.max(60, Math.ceil((maxVal + 10) / 10) * 10);
  const yTop = 25;
  const yBottom = 195;
  const chartHeight = yBottom - yTop;
  const xCoords = [150, 310, 470];
  const getY = (val) => yBottom - (val / maxY) * chartHeight;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(r * maxY));
  const polylinePoints = predictions
    .map((p, idx) => `${xCoords[idx]},${getY(p.value)}`)
    .join(' ');
  const dangerY = getY(DANGER_THRESHOLD);

  return (
    <>
      <nav className="top-navbar">
        <div className="nav-left">
          <div className="logo-box">
            <BarChart2 size={24} />
          </div>
          <div className="nav-titles">
            <h3>Dinas Lingkungan Hidup Kota Padang</h3>
            <h1>Dashboard Peringatan Dini PM2.5 - DLH Padang</h1>
          </div>
        </div>
        <div className="nav-right">
          <div className="nav-date">
            {currentDate}
            <strong>{currentTime} WIB</strong>
          </div>
          <div className="nav-user">
            <div className="user-icon">
              <User size={20} />
            </div>
            <div className="user-info">
              <h4>Petugas DLH</h4>
              <p>Administrator</p>
            </div>
          </div>
        </div>
      </nav>

      <div className="dashboard-container">
        <div className="page-header">
          <h4>MONITORING KUALITAS UDARA</h4>
          <h2>Analisis & Peringatan Dini</h2>
          <p>
            Unggah data sensor polutan dan cuaca untuk menghasilkan prediksi kualitas udara hingga 3 jam ke depan.
          </p>
        </div>

        <div className="content-grid">
          {/* KOLOM KIRI */}
          <div className="col-left">
            {/* Card 1: Input 2 File CSV Terpisah */}
            <div className="card">
              <div className="card-header-flex">
                <div className="number-badge">1</div>
                <div className="card-title-box">
                  <h3>Input Data Sensor</h3>
                  <p>Unggah 2 file CSV terpisah (Polutan & Cuaca)</p>
                </div>
              </div>

              <div className="upload-slots">
                <div
                  role="button"
                  tabIndex={0}
                  className={`upload-box-compact ${polutanFile ? 'uploaded' : ''}`}
                  onClick={() => document.getElementById('csv-polutan')?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      document.getElementById('csv-polutan')?.click();
                    }
                  }}
                >
                  <input
                    id="csv-polutan"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => handleFileSelect(e, setPolutanFile)}
                    style={{ display: 'none' }}
                  />
                  <div className="upload-icon-sm">
                    {polutanFile ? <CheckCircle size={20} /> : <CloudUpload size={20} />}
                  </div>
                  <div className="upload-text-box" style={{ flex: 1, minWidth: 0 }}>
                    <h4>{polutanFile ? polutanFile.name : '1. CSV Data Polutan'}</h4>
                    <p>Kolom: time, pm10, pm2_5, co, no2, so2, o3</p>
                  </div>
                  {polutanFile && (
                    <button
                      type="button"
                      aria-label="Hapus file polutan"
                      title="Hapus file"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPolutanFile(null);
                        setReferenceDate(null);
                        setHasPredicted(false);
                        setError(null);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#64748b',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: '4px',
                        flexShrink: 0,
                      }}
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  className={`upload-box-compact ${cuacaFile ? 'uploaded' : ''}`}
                  onClick={() => document.getElementById('csv-cuaca')?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      document.getElementById('csv-cuaca')?.click();
                    }
                  }}
                >
                  <input
                    id="csv-cuaca"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => handleFileSelect(e, setCuacaFile)}
                    style={{ display: 'none' }}
                  />
                  <div className="upload-icon-sm">
                    {cuacaFile ? <CheckCircle size={20} /> : <CloudUpload size={20} />}
                  </div>
                  <div className="upload-text-box" style={{ flex: 1, minWidth: 0 }}>
                    <h4>{cuacaFile ? cuacaFile.name : '2. CSV Data Cuaca'}</h4>
                    <p>Kolom: time, temp, rh, hujan, angin, arah_angin, tekanan</p>
                  </div>
                  {cuacaFile && (
                    <button
                      type="button"
                      aria-label="Hapus file cuaca"
                      title="Hapus file"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCuacaFile(null);
                        setReferenceDate(null);
                        setHasPredicted(false);
                        setError(null);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#64748b',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: '4px',
                        flexShrink: 0,
                      }}
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>

              <div className="info-text">
                <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  Minimal riwayat 200 jam terakhir per file. Kedua CSV akan digabungkan otomatis berdasarkan kolom <strong>time</strong>.
                </span>
              </div>
            </div>

            {/* Card 3: Panel Himbauan Publik */}
            <div className="card">
              <div className="card-header-flex">
                <div className="number-badge">3</div>
                <div className="card-title-box">
                  <h3>Panel Himbauan Publik</h3>
                  <p>Ringkasan peringatan dini 3 jam ke depan</p>
                </div>
              </div>

              {hasPredicted ? (
                <div className={`alert-card ${isDanger ? '' : 'safe'}`}>
                  <div className="status-tag">
                    {isDanger ? 'STATUS WASPADA' : 'STATUS AMAN'}
                  </div>
                  <div className="alert-title-row">
                    <AlertTriangle
                      size={20}
                      color={isDanger ? '#dc2626' : '#16a34a'}
                      fill={isDanger ? '#fecaca' : '#bbf7d0'}
                    />
                    <h3>
                      {isDanger ? 'WASPADA LONJAKAN POLUSI' : 'KUALITAS UDARA TERKENDALI'}
                    </h3>
                  </div>
                  <p>
                    <strong>
                      Prediksi tertinggi: {peakItem.value} µg/m³ ({peakItem.hour} jam ke depan)
                    </strong>
                  </p>
                  <p>Rekomendasi: {recommendationText}</p>
                </div>
              ) : (
                <div
                  style={{
                    border: '1.5px dashed #cbd5e1',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    textAlign: 'center',
                    color: '#64748b',
                    fontSize: '0.85rem',
                    marginBottom: '1rem',
                    backgroundColor: '#f8fafc',
                  }}
                >
                  Belum ada himbauan. Unggah 2 file CSV dan jalankan forecasting untuk melihat status peringatan dini.
                </div>
              )}

              <button
                type="button"
                className="btn-dark"
                onClick={handleDownloadPoster}
                disabled={!hasPredicted}
                style={{
                  opacity: hasPredicted ? 1 : 0.55,
                  cursor: hasPredicted ? 'pointer' : 'not-allowed',
                }}
              >
                <Download size={18} />{' '}
                {hasPredicted ? 'Unduh Poster (PNG)' : 'Jalankan Forecasting untuk Unduh Poster'}
              </button>
            </div>
          </div>

          {/* KOLOM KANAN */}
          <div className="col-right">
            <div
              className="card"
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <div className="chart-header-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <div className="card-header-flex" style={{ marginBottom: 0 }}>
                  <div className="number-badge">2</div>
                  <div className="card-title-box">
                    <h3>Grafik Tren Prediksi PM2.5</h3>
                    <p>Proyeksi konsentrasi partikulat 1 hingga 3 jam ke depan</p>
                  </div>
                </div>
                {hasPredicted && referenceDate && (
                  <div
                    style={{
                      fontSize: '0.78rem',
                      color: '#334155',
                      backgroundColor: '#f1f5f9',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '6px',
                      fontWeight: 500,
                    }}
                  >
                    Acuan data: <strong>{formatTanggalJamWIB(referenceDate)}</strong>
                  </div>
                )}
              </div>

              {hasPredicted ? (
                <>
                  <div className="metrics-grid">
                    <div className="metric-item">
                      <p>Konsentrasi saat ini</p>
                      <h2>
                        {currentPm25}{' '}
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>µg/m³</span>
                      </h2>
                    </div>
                    <div className="metric-item">
                      <p>Prediksi tertinggi (3 jam)</p>
                      <h2 className={isDanger ? 'text-red' : 'text-green'}>
                        {peakItem.value}{' '}
                        <span
                          style={{
                            fontSize: '0.8rem',
                            color: isDanger ? '#dc2626' : '#16a34a',
                          }}
                        >
                          µg/m³
                        </span>
                      </h2>
                      <span className="metric-sub">
                        Terjadi pada {peakItem.hour} jam ke depan
                      </span>
                    </div>
                    <div className="metric-item">
                      <p>Kategori kualitas udara</p>
                      <h2 style={{ fontSize: '1.35rem', color: isDanger ? '#dc2626' : '#0f172a' }}>
                        {statusLabel}
                      </h2>
                      <span className="metric-sub">Berdasarkan prediksi tertinggi</span>
                    </div>
                    <div className="metric-item">
                      <p>Status peringatan dini</p>
                      <div style={{ marginTop: '0.5rem' }}>
                        <span className={`status-dot ${isDanger ? '' : 'safe'}`}></span>
                        <span className="status-text">
                          {isDanger ? 'Waspada' : 'Aman'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Grafik SVG (1 jam, 2 jam, 3 jam) */}
                  <div className="chart-placeholder">
                    <svg
                      width="100%"
                      height="100%"
                      viewBox="0 0 600 245"
                      style={{ overflow: 'visible' }}
                    >
                      {yTicks.map((val, i) => {
                        const y = getY(val);
                        return (
                          <g key={i}>
                            <line
                              x1="55"
                              y1={y}
                              x2="565"
                              y2={y}
                              stroke="#f1f5f9"
                              strokeWidth="2"
                            />
                            <text
                              x="45"
                              y={y + 4}
                              fill="#94a3b8"
                              fontSize="12"
                              textAnchor="end"
                            >
                              {val}
                            </text>
                          </g>
                        );
                      })}

                      <text
                        x="12"
                        y="110"
                        fill="#94a3b8"
                        fontSize="12"
                        transform="rotate(-90 12 110)"
                        textAnchor="middle"
                      >
                        PM2.5 (µg/m³)
                      </text>

                      <line
                        x1="55"
                        y1={dangerY}
                        x2="565"
                        y2={dangerY}
                        stroke="#ef4444"
                        strokeWidth="2"
                        strokeDasharray="6,4"
                      />
                      <rect
                        x="415"
                        y={dangerY - 12}
                        width="150"
                        height="22"
                        fill="#fef2f2"
                        rx="4"
                      />
                      <text
                        x="490"
                        y={dangerY + 3}
                        fill="#b91c1c"
                        fontSize="11"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        Ambang Waspada ({DANGER_THRESHOLD} µg/m³)
                      </text>

                      <polyline
                        points={polylinePoints}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="4"
                        strokeLinejoin="round"
                      />

                      {predictions.map((item, i) => {
                        const cx = xCoords[i];
                        const cy = getY(item.value);
                        const pointDanger = item.value >= DANGER_THRESHOLD;
                        return (
                          <g key={item.hour}>
                            <text
                              x={cx}
                              y={cy - 14}
                              fill={pointDanger ? '#dc2626' : '#334155'}
                              fontSize="13"
                              fontWeight="bold"
                              textAnchor="middle"
                            >
                              {item.value}
                            </text>
                            <circle
                              cx={cx}
                              cy={cy}
                              r={pointDanger ? 6 : 5}
                              fill="white"
                              stroke={pointDanger ? '#dc2626' : '#2563eb'}
                              strokeWidth={pointDanger ? 4 : 3}
                            />
                            <text
                              x={cx}
                              y="218"
                              fill="#475569"
                              fontSize="13"
                              fontWeight="600"
                              textAnchor="middle"
                            >
                              {item.hour} jam
                            </text>
                          </g>
                        );
                      })}

                      <text
                        x="310"
                        y="240"
                        fill="#64748b"
                        fontSize="12"
                        textAnchor="middle"
                      >
                        Horizon Prediksi
                      </text>
                    </svg>
                  </div>

                  {/* Legend */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      gap: '2rem',
                      marginBottom: '0.75rem',
                      fontSize: '0.85rem',
                      color: '#64748b',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{ width: '20px', height: '3px', background: '#2563eb' }}
                      ></span>{' '}
                      Prediksi PM2.5
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{
                          width: '20px',
                          height: '3px',
                          borderTop: '2px dashed #ef4444',
                        }}
                      ></span>{' '}
                      Ambang Waspada ({DANGER_THRESHOLD} µg/m³)
                    </div>
                  </div>

                  {/* Catatan Kaki 5 Kategori PM2.5 */}
                  <div
                    style={{
                      textAlign: 'center',
                      fontSize: '0.75rem',
                      color: '#64748b',
                      marginBottom: '1.25rem',
                      lineHeight: 1.5,
                    }}
                  >
                    <strong>Kategori PM2.5 (µg/m³):</strong> Baik (0–15,5) • Sedang (15,6–55,4) • Tidak Sehat (55,5–150,4) • Sangat Tidak Sehat (150,5–250,4) • Berbahaya (&gt;250,4)
                  </div>
                </>
              ) : (
                <div
                  style={{
                    flex: 1,
                    minHeight: '320px',
                    border: '1.5px dashed #cbd5e1',
                    borderRadius: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: '2rem',
                    marginBottom: '1.5rem',
                    color: '#64748b',
                    backgroundColor: '#f8fafc',
                  }}
                >
                  <BarChart2 size={40} color="#94a3b8" style={{ marginBottom: '0.75rem' }} />
                  <h4 style={{ margin: '0 0 0.4rem 0', color: '#334155' }}>
                    Belum Ada Hasil Prediksi
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.85rem', maxWidth: '360px' }}>
                    Unggah file <strong>CSV Data Polutan</strong> dan <strong>CSV Data Cuaca</strong> di panel kiri, lalu klik <strong>Jalankan Forecasting</strong> untuk menampilkan metrik dan grafik tren PM2.5.
                  </p>
                </div>
              )}

              {error && <div className="error-banner">{error}</div>}

              <div style={{ marginTop: 'auto' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handlePredict}
                  disabled={loading || !polutanFile || !cuacaFile}
                >
                  {loading
                    ? 'Menghitung Prediksi...'
                    : !polutanFile || !cuacaFile
                    ? 'Unggah File Polutan & Cuaca untuk Memulai'
                    : 'Jalankan Forecasting'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="footer">
        <div>© 2026 Dinas Lingkungan Hidup Kota Padang</div>
        <div>Terintegrasi dengan Sistem Pemantauan Kualitas Udara (AQMS) Internal</div>
      </footer>
    </>
  );
}

export default App;