import React, { useState, useEffect } from 'react';
import {
  BarChart2,
  User,
  CloudUpload,
  CheckCircle,
  Info,
  AlertTriangle,
  Download,
} from 'lucide-react';
import './App.css';

// Ambang peringatan dini internal sesuai Progress Report 2 (35 µg/m³)
const DANGER_THRESHOLD = 35;

// Data pratinjau awal (1 jam, 2 jam, 3 jam) sebelum backend terhubung
const INITIAL_PREVIEW_DATA = {
  current_pm25: 24,
  predictions: [
    { hour: 1, value: 31 },
    { hour: 2, value: 39 },
    { hour: 3, value: 48 },
  ],
};

function App() {
  const [polutanFile, setPolutanFile] = useState(null);
  const [cuacaFile, setCuacaFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentDate, setCurrentDate] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [forecastData, setForecastData] = useState(INITIAL_PREVIEW_DATA);

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

  const handlePredict = async () => {
    if (!polutanFile || !cuacaFile) {
      setError('Unggah kedua file CSV (Polutan dan Cuaca) terlebih dahulu.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('file_polutan', polutanFile);
      formData.append('file_cuaca', cuacaFile);

      const response = await fetch('/api/predict', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Terjadi kesalahan pada server backend.');
      }

      if (data.predictions && Array.isArray(data.predictions) && data.predictions.length > 0) {
        const normalized = data.predictions.slice(0, 3).map((item, idx) => ({
          hour: item.hour ?? idx + 1,
          value: item.value,
        }));
        setForecastData({
          current_pm25: data.current_pm25 ?? INITIAL_PREVIEW_DATA.current_pm25,
          predictions: normalized,
        });
      }
    } catch (err) {
      setError(
        err.message || 'Gagal terhubung ke backend Flask. Pastikan server Flask aktif.'
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

  const deltaPercent =
    currentPm25 > 0
      ? Math.round(((peakItem.value - currentPm25) / currentPm25) * 100)
      : 0;
  const isDanger = peakItem.value >= DANGER_THRESHOLD;

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
      {/* TOP NAVBAR */}
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

      {/* MAIN DASHBOARD */}
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
                  className={`upload-box-compact ${polutanFile ? 'uploaded' : ''}`}
                  onClick={() => document.getElementById('csv-polutan').click()}
                >
                  <input
                    id="csv-polutan"
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      if (e.target.files[0]) setPolutanFile(e.target.files[0]);
                    }}
                    style={{ display: 'none' }}
                  />
                  <div className="upload-icon-sm">
                    {polutanFile ? <CheckCircle size={20} /> : <CloudUpload size={20} />}
                  </div>
                  <div className="upload-text-box">
                    <h4>{polutanFile ? polutanFile.name : '1. CSV Data Polutan'}</h4>
                    <p>Kolom: time, pm10, pm2_5, co, no2, so2, o3</p>
                  </div>
                </div>

                <div
                  className={`upload-box-compact ${cuacaFile ? 'uploaded' : ''}`}
                  onClick={() => document.getElementById('csv-cuaca').click()}
                >
                  <input
                    id="csv-cuaca"
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      if (e.target.files[0]) setCuacaFile(e.target.files[0]);
                    }}
                    style={{ display: 'none' }}
                  />
                  <div className="upload-icon-sm">
                    {cuacaFile ? <CheckCircle size={20} /> : <CloudUpload size={20} />}
                  </div>
                  <div className="upload-text-box">
                    <h4>{cuacaFile ? cuacaFile.name : '2. CSV Data Cuaca'}</h4>
                    <p>Kolom: time, suhu, kelembapan, tekanan, angin, hujan</p>
                  </div>
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
                <p>
                  Rekomendasi:{' '}
                  {isDanger
                    ? 'Masyarakat diimbau membatasi aktivitas luar ruang dan memakai masker.'
                    : 'Aktivitas luar ruang aman dilakukan seperti biasa.'}
                </p>
              </div>

              <button className="btn-dark" onClick={() => window.print()}>
                <Download size={18} /> Cetak Poster (PNG / PDF)
              </button>
            </div>
          </div>

          {/* KOLOM KANAN */}
          <div className="col-right">
            <div
              className="card"
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <div className="chart-header-row">
                <div className="card-header-flex" style={{ marginBottom: 0 }}>
                  <div className="number-badge">2</div>
                  <div className="card-title-box">
                    <h3>Grafik Tren Prediksi PM2.5</h3>
                    <p>Proyeksi konsentrasi partikulat 1 hingga 3 jam ke depan</p>
                  </div>
                </div>
              </div>

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
                  <p>Perubahan prediksi</p>
                  <h2 className={deltaPercent > 0 ? 'text-orange' : 'text-green'}>
                    {deltaPercent >= 0 ? `+${deltaPercent}%` : `${deltaPercent}%`}
                  </h2>
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
                    Horizon Prediksi (n jam = n jam ke depan)
                  </text>
                </svg>
              </div>

              {/* Legend */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '2rem',
                  marginBottom: '1.5rem',
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

              {error && <div className="error-banner">{error}</div>}

              <div style={{ marginTop: 'auto' }}>
                <button
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
