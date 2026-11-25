/**
 * 拍拍健康記（網路公開版）— 優先使用雲端免金鑰 /api/analyze 代理，離線開發時支援個人 Key 備援
 */
(function () {
  window.SnapHealth = window.SnapHealth || {};

  const FALLBACK_MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-3.8-pro'
  ];

  let cloudStatus = {
    checked: false,
    serverKeyConfigured: false,
    dailyLimit: 20
  };

  async function checkCloudBackend() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      cloudStatus = { checked: true, serverKeyConfigured: false, dailyLimit: 20 };
      return cloudStatus;
    }
    try {
      const res = await fetch('./api/health', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        cloudStatus = {
          checked: true,
          serverKeyConfigured: Boolean(data && data.serverKeyConfigured),
          dailyLimit: Number(data?.dailyLimit || 20)
        };
        return cloudStatus;
      }
    } catch {}
    cloudStatus = { checked: true, serverKeyConfigured: false, dailyLimit: 20 };
    return cloudStatus;
  }

  function getCloudStatus() {
    return cloudStatus;
  }

  function compressImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('讀取照片失敗'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('照片格式無法解析'));
        img.onload = () => {
          const full = resizeToDataUrl(img, 1200, 0.84);
          const thumb = resizeToDataUrl(img, 420, 0.72);
          const base64 = full.split(',')[1];
          resolve({
            dataUrl: full,
            thumbDataUrl: thumb,
            base64,
            mimeType: 'image/jpeg'
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function resizeToDataUrl(img, maxDim, quality) {
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxDim || h > maxDim) {
      if (w >= h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  }

  /**
   * 呼叫 Cloudflare Pages Function 後端代理（使用者完全免填金鑰）
   */
  async function analyzeViaCloudBackend(base64, mimeType, preferredModel, onStatus) {
    if (onStatus) onStatus('正在透過雲端 AI 辨識儀器螢幕...');
    const res = await fetch('./api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base64,
        mimeType,
        model: preferredModel || 'auto'
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data?.code === 'PHOTO_UNREADABLE') {
        throw new Error(`PHOTO_UNREADABLE:${data.error}`);
      }
      throw new Error(data?.error || `雲端辨識暫時失敗 (${res.status})`);
    }

    return {
      mode: 'gemini',
      modelUsed: data.modelUsed || 'cloud',
      type: data.type,
      values: data.values || {},
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.9,
      needsRetake: Boolean(data.needsRetake),
      note: data.note || 'AI 辨識完成'
    };
  }

  async function discoverLiveModels(apiKey) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
      if (!res.ok) return [];
      const json = await res.json();
      const models = (json.models || [])
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((name) => /^gemini-/i.test(name) && !/(tts|image|embedding|aqa|veo|imagen|robotics|computer-use|deep-research)/i.test(name));
      models.sort((a, b) => {
        const score = (n) => (/flash-lite/i.test(n) ? 0 : /flash/i.test(n) ? 1 : 2);
        return score(a) - score(b);
      });
      return models.slice(0, 6);
    } catch {
      return [];
    }
  }

  function buildCandidateList(preferredModel) {
    const list = [];
    if (preferredModel && preferredModel !== 'auto') list.push(preferredModel);
    FALLBACK_MODELS.forEach((m) => {
      if (!list.includes(m)) list.push(m);
    });
    return list;
  }

  async function testApiKey(apiKey, modelName) {
    let candidates = buildCandidateList(modelName);
    let lastErr = '連線失敗';

    for (let pass = 0; pass < 2; pass++) {
      for (const model of candidates) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Reply with OK' }] }],
              generationConfig: { maxOutputTokens: 8 }
            })
          });
          if (res.ok) return { ok: true, model };
          const err = await res.json().catch(() => ({}));
          const msg = err?.error?.message || `HTTP ${res.status}`;
          lastErr = `[${model}] ${msg}`;
          if (res.status === 400 && /API key not valid/i.test(msg)) {
            throw new Error('API Key 無效，請確認是否複製完整。');
          }
          if (res.status === 401 || res.status === 403) {
            throw new Error(`金鑰權限錯誤：${msg}`);
          }
        } catch (e) {
          if (/API Key 無效|金鑰權限錯誤/.test(e.message)) throw e;
          lastErr = e.message || lastErr;
        }
      }
      if (pass === 0) {
        const live = await discoverLiveModels(apiKey);
        const fresh = live.filter((m) => !candidates.includes(m));
        if (!fresh.length) break;
        candidates = fresh;
      }
    }
    throw new Error(lastErr);
  }

  async function analyzeWithDirectGemini(base64, mimeType, apiKey, modelName, onStatus) {
    const prompt = `你是一個專門協助台灣銀髮族讀取居家健康儀器螢幕的 AI 視覺專家。
請觀察照片中的健康量測儀器（血壓計、血糖機、血氧心律計、體重計、額溫/耳溫槍，支援橫拍或旋轉 90/270 度及日/中/英文面板，忽略時鐘時間與記憶編號，自動將 mmol/L 換算 mg/dL、lb 換算 kg）。
嚴格只回傳 JSON：
{"device_type":"blood_pressure"|"blood_glucose"|"oximeter"|"weight"|"temperature"|"unknown","values":{"systolic":number,"diastolic":number,"pulse":number,"glucose":number,"mealTiming":"fasting"|"postprandial"|"random","spo2":number,"weight":number,"bodyFat":number,"temperature":number},"confidence":0.95,"needs_retake":false,"note":"簡短繁中說明"}`;

    let candidates = buildCandidateList(modelName);
    let lastErr = 'AI 伺服器忙碌中';

    for (let pass = 0; pass < 2; pass++) {
      for (let idx = 0; idx < candidates.length; idx++) {
        const model = candidates[idx];
        if (onStatus && (pass > 0 || idx > 0)) {
          onStatus(`主通道忙碌中，自動切換 ${model} 辨識...`);
        }
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        let res;
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
              generationConfig: { temperature: 0.05, responseMimeType: 'application/json' }
            })
          });
        } catch {
          lastErr = '網路連線異常';
          continue;
        }
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          const msg = errJson?.error?.message || `HTTP ${res.status}`;
          if (res.status === 400 && /API key not valid/i.test(msg)) throw new Error('Gemini API Key 無效');
          lastErr = msg;
          continue;
        }
        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        let parsed;
        try { parsed = JSON.parse(cleaned); } catch { continue; }
        if (!parsed || !parsed.device_type || parsed.device_type === 'unknown') {
          throw new Error('PHOTO_UNREADABLE:照片中未偵測到清楚的健康儀器螢幕，請稍微靠近螢幕並避開反光後重拍。');
        }
        return {
          mode: 'gemini',
          modelUsed: model,
          type: parsed.device_type,
          values: parsed.values || {},
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
          needsRetake: Boolean(parsed.needs_retake),
          note: parsed.note || 'AI 辨識完成'
        };
      }
      if (pass === 0) {
        const live = await discoverLiveModels(apiKey);
        const fresh = live.filter((m) => !candidates.includes(m));
        if (!fresh.length) break;
        candidates = fresh;
      }
    }
    throw new Error(`Google AI 伺服器目前尖峰忙碌（${lastErr}），請稍等幾秒再試。`);
  }

  function createMockMeterSample(deviceType) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(0, 0, 640, 420);
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 36, 26, 568, 368, 32);
    ctx.fill();
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#D8E3D5';
    roundRect(ctx, 76, 76, 488, 250, 18);
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold 24px sans-serif';

    let values = {};
    const note = '模擬儀器體驗紀錄';

    if (deviceType === 'blood_pressure') {
      const sys = 122 + Math.floor(Math.random() * 24);
      const dia = 76 + Math.floor(Math.random() * 14);
      const pulse = 66 + Math.floor(Math.random() * 16);
      values = { systolic: sys, diastolic: dia, pulse };
      ctx.fillText('OMRON-STYLE 血壓計（模擬畫面）', 98, 60);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 22px monospace';
      ctx.fillText('SYS  mmHg', 104, 126);
      ctx.fillText('DIA  mmHg', 104, 210);
      ctx.fillText('PULSE /min', 104, 292);
      ctx.font = 'bold 74px monospace';
      ctx.fillText(String(sys), 340, 148);
      ctx.fillText(String(dia), 340, 228);
      ctx.font = 'bold 54px monospace';
      ctx.fillText(String(pulse), 370, 302);
    } else if (deviceType === 'blood_glucose') {
      const glucose = 96 + Math.floor(Math.random() * 52);
      values = { glucose, mealTiming: 'fasting' };
      ctx.fillText('FORA-STYLE 血糖機（模擬畫面）', 104, 60);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 110px monospace';
      ctx.fillText(String(glucose), 190, 225);
      ctx.font = 'bold 34px monospace';
      ctx.fillText('mg/dL', 420, 225);
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('飯前量測', 106, 298);
    } else if (deviceType === 'oximeter') {
      const spo2 = 96 + Math.floor(Math.random() * 4);
      const pulse = 68 + Math.floor(Math.random() * 14);
      values = { spo2, pulse };
      ctx.fillStyle = '#0F172A';
      roundRect(ctx, 76, 76, 488, 250, 18);
      ctx.fill();
      ctx.fillStyle = '#1E293B';
      ctx.fillText('指夾式血氧心律計（模擬畫面）', 110, 60);
      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('SpO2 %', 115, 132);
      ctx.font = 'bold 96px monospace';
      ctx.fillText(String(spo2), 115, 248);
      ctx.fillStyle = '#4ADE80';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('PR bpm', 360, 132);
      ctx.font = 'bold 88px monospace';
      ctx.fillText(String(pulse), 360, 248);
    } else if (deviceType === 'weight') {
      const weight = Number((58 + Math.random() * 14).toFixed(1));
      const bodyFat = Number((21 + Math.random() * 7).toFixed(1));
      values = { weight, bodyFat };
      ctx.fillText('居家體重體脂計（模擬畫面）', 130, 60);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 96px monospace';
      ctx.fillText(`${weight.toFixed(1)}`, 148, 220);
      ctx.font = 'bold 38px monospace';
      ctx.fillText('kg', 420, 220);
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(`體脂 ${bodyFat.toFixed(1)}%`, 225, 292);
    } else {
      const temperature = Number((36.3 + Math.random() * 1.1).toFixed(1));
      values = { temperature };
      ctx.fillText('額溫／耳溫槍（模擬畫面）', 148, 60);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 104px monospace';
      ctx.fillText(`${temperature.toFixed(1)}`, 148, 232);
      ctx.font = 'bold 48px monospace';
      ctx.fillText('°C', 435, 232);
    }

    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('拍拍健康記 — 模擬儀器測試畫面', 165, 368);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    return {
      dataUrl,
      thumbDataUrl: dataUrl,
      result: { mode: 'demo', type: deviceType, values, confidence: 0.99, needsRetake: false, note }
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * 統一辨識入口：
   * 1. 若雲端後端已設定 GEMINI_API_KEY -> 直接走 /api/analyze（使用者完全免填 Key！）
   * 2. 否則若使用者有在進階設定填個人 Key -> 直接呼叫 Gemini API
   * 3. 否則回傳 no_key（不塞假數字）
   */
  async function analyzePhoto(compressedImg, onStatus) {
    if (!cloudStatus.checked) {
      await checkCloudBackend();
    }
    const settings = window.SnapHealth.Storage.getSettings();

    if (cloudStatus.serverKeyConfigured) {
      return await analyzeViaCloudBackend(
        compressedImg.base64,
        compressedImg.mimeType,
        settings.geminiModel,
        onStatus
      );
    }

    if (settings.apiKey && settings.apiKey.trim().length > 10) {
      return await analyzeWithDirectGemini(
        compressedImg.base64,
        compressedImg.mimeType,
        settings.apiKey.trim(),
        settings.geminiModel,
        onStatus
      );
    }

    return {
      mode: 'no_key',
      type: 'blood_pressure',
      values: {},
      confidence: 0,
      needsRetake: false,
      note: ''
    };
  }

  window.SnapHealth.AIVision = {
    checkCloudBackend,
    getCloudStatus,
    compressImageFile,
    analyzePhoto,
    testApiKey,
    createMockMeterSample
  };
})();
