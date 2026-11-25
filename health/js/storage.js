/**
 * 拍拍健康記 — 資料模型、健康參考分級與本機儲存（IndexedDB + LocalStorage 備援）
 */
(function () {
  window.SnapHealth = window.SnapHealth || {};

  const DB_NAME = 'SnapHealthDB';
  const DB_VERSION = 1;
  const STORE_RECORDS = 'records';
  const SETTINGS_KEY = 'snap_health_settings_v1';
  const FALLBACK_RECORDS_KEY = 'snap_health_records_fallback_v1';
  const SEEDED_KEY = 'snap_health_seeded_v1';

  const DEVICE_TYPES = {
    blood_pressure: {
      id: 'blood_pressure',
      name: '血壓計',
      shortName: '血壓',
      icon: '❤️',
      primaryUnit: 'mmHg',
      fields: [
        { key: 'systolic', label: '收縮壓 (高壓)', unit: 'mmHg', step: 1, min: 50, max: 260, defaultVal: 125 },
        { key: 'diastolic', label: '舒張壓 (低壓)', unit: 'mmHg', step: 1, min: 30, max: 160, defaultVal: 80 },
        { key: 'pulse', label: '心跳 (脈搏)', unit: '次/分', step: 1, min: 35, max: 200, defaultVal: 72 }
      ]
    },
    blood_glucose: {
      id: 'blood_glucose',
      name: '血糖機',
      shortName: '血糖',
      icon: '🩸',
      primaryUnit: 'mg/dL',
      fields: [
        { key: 'glucose', label: '血糖數值', unit: 'mg/dL', step: 1, min: 20, max: 600, defaultVal: 108 }
      ],
      extraSelect: {
        key: 'mealTiming',
        label: '量測時段',
        options: [
          { value: 'fasting', label: '飯前（空腹）' },
          { value: 'postprandial', label: '飯後 2 小時' },
          { value: 'random', label: '隨機／睡前' }
        ]
      }
    },
    oximeter: {
      id: 'oximeter',
      name: '血氧心律計',
      shortName: '血氧心律',
      icon: '🫁',
      primaryUnit: '%',
      fields: [
        { key: 'spo2', label: '血氧濃度 (SpO2)', unit: '%', step: 1, min: 60, max: 100, defaultVal: 98 },
        { key: 'pulse', label: '心律（脈搏）', unit: '次/分', step: 1, min: 35, max: 200, defaultVal: 74 }
      ]
    },
    weight: {
      id: 'weight',
      name: '體重計',
      shortName: '體重',
      icon: '⚖️',
      primaryUnit: 'kg',
      fields: [
        { key: 'weight', label: '體重', unit: '公斤 (kg)', step: 0.1, min: 20, max: 200, defaultVal: 62.5 },
        { key: 'bodyFat', label: '體脂率（選填，無則填 0）', unit: '%', step: 0.1, min: 0, max: 65, defaultVal: 0 }
      ]
    },
    temperature: {
      id: 'temperature',
      name: '額溫／耳溫槍',
      shortName: '體溫',
      icon: '🌡️',
      primaryUnit: '°C',
      fields: [
        { key: 'temperature', label: '體溫', unit: '°C', step: 0.1, min: 34.0, max: 42.5, defaultVal: 36.5 }
      ]
    }
  };

  const DEFAULT_SETTINGS = {
    elderName: '阿公／阿嬤',
    apiKey: '',
    geminiModel: 'auto',
    voiceEnabled: true,
    voiceRate: 0.88,
    fontXL: false
  };

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      if (!parsed.geminiModel || parsed.geminiModel === 'gemini-2.5-flash' || parsed.geminiModel === 'gemini-2.0-flash' || parsed.geminiModel === 'gemini-3.8-flash') {
        parsed.geminiModel = 'auto';
      }
      return parsed;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(partial) {
    const next = { ...getSettings(), ...partial };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  /**
   * 依一般居家參考範圍給出視覺提示（非醫療診斷）
   */
  function evaluateRecord(rec) {
    if (!rec || !rec.values) return { level: 'ok', label: '已紀錄' };
    const v = rec.values;
    switch (rec.type) {
      case 'blood_pressure': {
        const sys = Number(v.systolic) || 0;
        const dia = Number(v.diastolic) || 0;
        if (sys >= 140 || dia >= 90) return { level: 'danger', label: '偏高注意' };
        if (sys < 90 || dia < 60) return { level: 'warn', label: '偏低注意' };
        if (sys >= 130 || dia >= 85) return { level: 'warn', label: '略高' };
        return { level: 'ok', label: '正常' };
      }
      case 'blood_glucose': {
        const g = Number(v.glucose) || 0;
        const fasting = v.mealTiming === 'fasting';
        if (g < 70) return { level: 'danger', label: '偏低注意' };
        if (fasting && g >= 126) return { level: 'danger', label: '偏高注意' };
        if (!fasting && g >= 200) return { level: 'danger', label: '偏高注意' };
        if ((fasting && g >= 100) || (!fasting && g >= 140)) return { level: 'warn', label: '略高' };
        return { level: 'ok', label: '正常' };
      }
      case 'oximeter': {
        const spo2 = Number(v.spo2) || 0;
        if (spo2 < 92) return { level: 'danger', label: '偏低注意' };
        if (spo2 < 95) return { level: 'warn', label: '略低' };
        return { level: 'ok', label: '正常' };
      }
      case 'temperature': {
        const t = Number(v.temperature) || 0;
        if (t >= 38.0) return { level: 'danger', label: '發燒注意' };
        if (t >= 37.5 || t < 35.5) return { level: 'warn', label: '略異常' };
        return { level: 'ok', label: '正常' };
      }
      case 'weight':
      default:
        return { level: 'ok', label: '已紀錄' };
    }
  }

  function formatReadingText(rec) {
    const v = rec.values || {};
    switch (rec.type) {
      case 'blood_pressure':
        return `${v.systolic}/${v.diastolic} mmHg${v.pulse ? ` · 心跳 ${v.pulse}` : ''}`;
      case 'blood_glucose': {
        const tag = v.mealTiming === 'fasting' ? '飯前' : v.mealTiming === 'postprandial' ? '飯後' : '隨機';
        return `${v.glucose} mg/dL（${tag}）`;
      }
      case 'oximeter':
        return `血氧 ${v.spo2}%${v.pulse ? ` · 心律 ${v.pulse}` : ''}`;
      case 'weight':
        return `${v.weight} kg${Number(v.bodyFat) > 0 ? ` · 體脂 ${v.bodyFat}%` : ''}`;
      case 'temperature':
        return `${v.temperature} °C`;
      default:
        return '-';
    }
  }

  function formatShortValue(rec) {
    const v = rec.values || {};
    switch (rec.type) {
      case 'blood_pressure':
        return `${v.systolic}/${v.diastolic}`;
      case 'blood_glucose':
        return `${v.glucose}`;
      case 'oximeter':
        return `${v.spo2}%`;
      case 'weight':
        return `${v.weight}`;
      case 'temperature':
        return `${v.temperature}°C`;
      default:
        return '-';
    }
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${hh}:${mm}`;
  }

  function isSameDay(tsA, tsB) {
    const a = new Date(tsA);
    const b = new Date(tsB);
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  // IndexedDB helpers with localStorage fallback
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          const store = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function loadFallback() {
    try {
      return JSON.parse(localStorage.getItem(FALLBACK_RECORDS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveFallback(list) {
    try {
      localStorage.setItem(FALLBACK_RECORDS_KEY, JSON.stringify(list));
    } catch {
      // Strip thumbnails if localStorage quota exceeded
      const slim = list.map((r) => ({ ...r, thumbDataUrl: '' }));
      localStorage.setItem(FALLBACK_RECORDS_KEY, JSON.stringify(slim));
    }
  }

  async function getAllRecords() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, 'readonly');
        const req = tx.objectStore(STORE_RECORDS).getAll();
        req.onsuccess = () => {
          const arr = (req.result || []).sort((a, b) => b.timestamp - a.timestamp);
          resolve(arr);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return loadFallback().sort((a, b) => b.timestamp - a.timestamp);
    }
  }

  async function addRecord(record) {
    const rec = {
      id: record.id || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: record.timestamp || Date.now(),
      type: record.type,
      values: record.values,
      note: record.note || '',
      source: record.source || 'camera',
      thumbDataUrl: record.thumbDataUrl || '',
      isSample: Boolean(record.isSample)
    };
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, 'readwrite');
        tx.objectStore(STORE_RECORDS).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      const list = loadFallback();
      list.unshift(rec);
      saveFallback(list);
    }
    return rec;
  }

  async function deleteRecord(id) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, 'readwrite');
        tx.objectStore(STORE_RECORDS).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      const list = loadFallback().filter((r) => r.id !== id);
      saveFallback(list);
    }
  }

  async function clearSampleRecords() {
    const all = await getAllRecords();
    const samples = all.filter((r) => r.isSample);
    for (const s of samples) {
      await deleteRecord(s.id);
    }
  }

  async function clearAllRecords() {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, 'readwrite');
        tx.objectStore(STORE_RECORDS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      localStorage.removeItem(FALLBACK_RECORDS_KEY);
    }
  }

  async function seedInitialSamplesIfNeeded() {
    if (localStorage.getItem(SEEDED_KEY)) return;
    const existing = await getAllRecords();
    if (existing.length > 0) {
      localStorage.setItem(SEEDED_KEY, '1');
      return;
    }
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const samples = [
      {
        timestamp: now - 2 * 60 * 60 * 1000,
        type: 'blood_pressure',
        values: { systolic: 128, diastolic: 82, pulse: 71 },
        note: '範例紀錄（早上起床量測）',
        source: 'demo',
        isSample: true
      },
      {
        timestamp: now - 3 * 60 * 60 * 1000,
        type: 'blood_glucose',
        values: { glucose: 106, mealTiming: 'fasting' },
        note: '範例紀錄（早餐前）',
        source: 'demo',
        isSample: true
      },
      {
        timestamp: now - 1 * day - 1 * 60 * 60 * 1000,
        type: 'blood_pressure',
        values: { systolic: 136, diastolic: 86, pulse: 74 },
        note: '範例紀錄（昨日晚上）',
        source: 'demo',
        isSample: true
      },
      {
        timestamp: now - 2 * day,
        type: 'blood_pressure',
        values: { systolic: 142, diastolic: 91, pulse: 78 },
        note: '範例紀錄（親戚家血壓計）',
        source: 'demo',
        isSample: true
      },
      {
        timestamp: now - 1 * day,
        type: 'weight',
        values: { weight: 63.2, bodyFat: 24.5 },
        note: '範例紀錄',
        source: 'demo',
        isSample: true
      },
      {
        timestamp: now - 3 * day,
        type: 'oximeter',
        values: { spo2: 98, pulse: 72 },
        note: '範例紀錄',
        source: 'demo',
        isSample: true
      }
    ];
    for (const s of samples) {
      await addRecord(s);
    }
    localStorage.setItem(SEEDED_KEY, '1');
  }

  function exportRecordsCSV(records) {
    const header = ['日期時間', '儀器類型', '量測數值', '狀態參考', '備註'];
    const rows = records.map((r) => {
      const info = DEVICE_TYPES[r.type] || { name: r.type };
      const st = evaluateRecord(r);
      return [
        new Date(r.timestamp).toLocaleString('zh-TW'),
        info.name,
        formatReadingText(r),
        st.label,
        (r.note || '').replace(/,/g, ' ')
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
    });
    return '\uFEFF' + [header.join(','), ...rows].join('\n');
  }

  window.SnapHealth.Storage = {
    DEVICE_TYPES,
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    evaluateRecord,
    formatReadingText,
    formatShortValue,
    formatDateTime,
    isSameDay,
    getAllRecords,
    addRecord,
    deleteRecord,
    clearSampleRecords,
    clearAllRecords,
    seedInitialSamplesIfNeeded,
    exportRecordsCSV
  };
})();
