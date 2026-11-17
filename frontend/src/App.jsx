import React, { useState, useEffect } from 'react';
import { BarChart2, User, CloudUpload, Info, AlertTriangle, Download } from 'lucide-react';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [horizon, setHorizon] = useState('6'); // Default t+6
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  
  const [forecast, setForecast] = useState(null);

  useEffect(() => {
    setCurrentTime(new Date().toLocaleTimeString('id-ID'));
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('id-ID'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handlePredict = async () => {
    setLoading(true);
    try {
      const formData = new FormData();
      if (file) formData.append('file', file);
      formData.append('horizon', horizon);
      
      const response = await fetch('/api/predict', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      setForecast(data);
    } catch (err) {
      console.log("Menunggu backend Flask terhubung...");
    } finally {
      setTimeout(() => setLoading(false), 1000); 
    }
  };

  return (
    <>
      {/* TOP NAVBAR */}
      <nav className="top-navbar">
        <div className="nav-left">
          <div className="logo-box"><BarChart2 size={24} /></div>
          <div className="nav-titles">
            <h3>Dinas Lingkungan Hidup Kota Padang</h3>
            <h1>Dashboard Peringatan Dini PM2.5 - DLH Padang</h1>
          </div>
        </div>
        <div className="nav-right">
          <div className="nav-date">
            Senin, 16 November 2026
            <strong>{currentTime} WIB</strong>
          </div>
          <div className="nav-user">
            <div className="user-icon"><User size={20} /></div>
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
          <p>Unggah data sensor untuk menghasilkan prediksi kualitas udara hingga enam jam ke depan.</p>
        </div>

        <div className="content-grid">
          
          {/* KOLOM KIRI */}
          <div className="col-left">
            
            <div className="card">
              <div className="card-header-flex">
                <div className="number-badge">1</div>
                <div className="card-title-box">
                  <h3>Input Data Sensor</h3>
                  <p>Data historis sensor AQMS internal</p>
                </div>
              </div>

              <div className="upload-box" onClick={() => document.getElementById('csv-upload').click()}>
                <input id="csv-upload" type="file" accept=".csv" onChange={handleFileChange} style={{ display: 'none' }} />
                <div className="upload-icon"><CloudUpload size={24} /></div>
                <h4>{file ? file.name : "Unggah CSV, min 168 jam"}</h4>
                <p>Drag & drop atau klik untuk memilih</p>
                <span className="badge-csv">CSV • MAKS. 10 MB</span>
              </div>

              <div className="info-text">
                <Info size={16} style={{flexShrink: 0, marginTop: '2px'}}/>
                <span>Format: time, pm10, pm2_5, co, no2, so2, o3</span>
              </div>
            </div>

            <div className="card">
              <div className="card-header-flex">
                <div className="number-badge">3</div>
                <div className="card-title-box">
                  <h3>Panel Himbauan Publik</h3>
                  <p>Materi publikasi kualitas udara</p>
                </div>
              </div>

              <div className="alert-card">
                <div className="status-tag">STATUS BAHAYA</div>
                <div className="alert-title-row">
                  <AlertTriangle size={20} color="#dc2626" fill="#fecaca" />
                  <h3>WASPADA LONJAKAN POLUSI</h3>
                </div>
                {/* Teks diubah jadi dinamis sesuai horizon */}
                <p><strong>Prediksi (t+{horizon} jam): 104 µg/m³</strong></p>
                <p>Rekomendasi: Batasi aktivitas luar ruang.</p>
              </div>

              <button className="btn-dark">
                <Download size={18} /> Cetak Poster (PNG)
              </button>
            </div>
          </div>

          {/* KOLOM KANAN */}
          <div className="col-right">
            <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              
              <div className="chart-header-row">
                <div className="card-header-flex" style={{marginBottom: 0}}>
                  <div className="number-badge">2</div>
                  <div className="card-title-box">
                    <h3>Grafik Tren Prediksi PM2.5</h3>
                    <p>Proyeksi konsentrasi partikulat berdasarkan data sensor terbaru</p>
                  </div>
                </div>
                <div className="dropdown-container">
                  Pilih Horizon Prediksi:
                  {/* Dropdown dilengkapi t+1 sampai t+6 */}
                  <select value={horizon} onChange={(e) => setHorizon(e.target.value)}>
                    <option value="1">t+1 Jam</option>
                    <option value="2">t+2 Jam</option>
                    <option value="3">t+3 Jam</option>
                    <option value="4">t+4 Jam</option>
                    <option value="5">t+5 Jam</option>
                    <option value="6">t+6 Jam</option>
                  </select>
                </div>
              </div>

              <div className="metrics-grid">
                <div className="metric-item">
                  <p>Konsentrasi saat ini</p>
                  <h2>44 <span style={{fontSize: '0.8rem', color:'#64748b'}}>µg/m³</span></h2>
                </div>
                <div className="metric-item">
                  {/* Teks diubah jadi dinamis sesuai horizon */}
                  <p>Prediksi (t+{horizon} jam)</p>
                  <h2 className="text-red">104 <span style={{fontSize: '0.8rem', color:'#dc2626'}}>µg/m³</span></h2>
                </div>
                <div className="metric-item">
                  <p>Kenaikan prediksi</p>
                  <h2 className="text-orange">+136%</h2>
                </div>
                <div className="metric-item">
                  <p>Status kualitas udara</p>
                  <div style={{marginTop: '0.5rem'}}>
                    <span className="status-dot"></span>
                    <span className="status-text">Tidak Sehat</span>
                  </div>
                </div>
              </div>

              {/* Hardcoded SVG Chart */}
              <div className="chart-placeholder">
                <svg width="100%" height="100%" viewBox="0 0 600 220" style={{overflow: 'visible'}}>
                  {[0, 30, 60, 90, 120].map((val, i) => (
                    <g key={i}>
                      <line x1="40" y1={200 - (val * 1.5)} x2="580" y2={200 - (val * 1.5)} stroke="#f1f5f9" strokeWidth="2" />
                      <text x="30" y={200 - (val * 1.5) + 4} fill="#94a3b8" fontSize="12" textAnchor="end">{val}</text>
                    </g>
                  ))}
                  
                  <line x1="40" y1={200 - (85 * 1.5)} x2="580" y2={200 - (85 * 1.5)} stroke="#ef4444" strokeWidth="2" strokeDasharray="6,4" />
                  <rect x="460" y={200 - (85 * 1.5) - 10} width="120" height="20" fill="#fef2f2" rx="4"/>
                  <text x="520" y={200 - (85 * 1.5) + 4} fill="#b91c1c" fontSize="11" fontWeight="bold" textAnchor="middle">Batas Bahaya (85 µg/m³)</text>
                  <text x="-90" y="100" fill="#94a3b8" fontSize="12" transform="rotate(-90 -90 100)" textAnchor="middle">PM2.5 (µg/m³)</text>

                  {['Jam 1', 'Jam 2', 'Jam 3', 'Jam 4', 'Jam 5', 'Jam 6'].map((label, i) => (
                    <text key={i} x={80 + (i * 90)} y="220" fill="#94a3b8" fontSize="12" textAnchor="middle">{label}</text>
                  ))}

                  <polyline points="80,134 170,123.5 260,108.5 350,89 440,68 530,44" fill="none" stroke="#2563eb" strokeWidth="4" strokeLinejoin="round" />
                  <path d="M 440,68 L 530,44 L 530,200 L 440,200 Z" fill="#eff6ff" opacity="0.5" />

                  <text x="80" y="122" fill="#64748b" fontSize="12" textAnchor="middle">44</text>
                  <text x="170" y="111.5" fill="#64748b" fontSize="12" textAnchor="middle">51</text>
                  <text x="260" y="96.5" fill="#64748b" fontSize="12" textAnchor="middle">61</text>
                  <text x="350" y="77" fill="#64748b" fontSize="12" textAnchor="middle">74</text>
                  <text x="440" y="56" fill="#64748b" fontSize="12" textAnchor="middle">88</text>
                  <text x="530" y="32" fill="#1e293b" fontSize="12" fontWeight="bold" textAnchor="middle">104</text>

                  <circle cx="80" cy="134" r="5" fill="white" stroke="#2563eb" strokeWidth="3" />
                  <circle cx="170" cy="123.5" r="5" fill="white" stroke="#2563eb" strokeWidth="3" />
                  <circle cx="260" cy="108.5" r="5" fill="white" stroke="#2563eb" strokeWidth="3" />
                  <circle cx="350" cy="89" r="5" fill="white" stroke="#2563eb" strokeWidth="3" />
                  <circle cx="440" cy="68" r="5" fill="white" stroke="#2563eb" strokeWidth="3" />
                  <circle cx="530" cy="44" r="6" fill="white" stroke="#dc2626" strokeWidth="4" />
                </svg>
              </div>

              <div style={{display:'flex', justifyContent:'center', gap:'2rem', marginBottom:'2rem', fontSize:'0.85rem', color:'#64748b'}}>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem'}}><span style={{width:'20px', height:'3px', background:'#2563eb'}}></span> Prediksi PM2.5</div>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem'}}><span style={{width:'20px', height:'3px', borderTop:'2px dashed #ef4444'}}></span> Batas Bahaya (85 µg/m³)</div>
              </div>

              <div style={{marginTop: 'auto'}}>
                <button className="btn-primary" onClick={handlePredict} disabled={loading}>
                  {loading ? "Menghitung Prediksi..." : "Jalankan Forecasting"}
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