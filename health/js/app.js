/**
 * 拍拍健康記（公開網路版 PWA）— 主程式控制邏輯
 */
(function () {
  const Storage = window.SnapHealth.Storage;
  const Speech = window.SnapHealth.Speech;
  const AIVision = window.SnapHealth.AIVision;
  const ChartAndShare = window.SnapHealth.ChartAndShare;

  const state = {
    activeView: 'home',
    records: [],
    historyFilter: 'blood_pressure',
    deferredInstallPrompt: null,
    draft: null
  };

  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const el = $('toastEl');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function applySettingsUI() {
    const s = Storage.getSettings();
    const cloud = AIVision.getCloudStatus();
    document.body.classList.toggle('font-xl', Boolean(s.fontXL));

    const todayStr = new Date().toLocaleDateString('zh-TW', {
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    });
    $('headerSub').textContent = `${s.elderName || '長輩'} · ${todayStr}`;
    $('todayDateText').textContent = todayStr;

    const badge = $('modeBadge');
    const cloudBanner = $('cloudStatusBanner');
    const cloudText = $('cloudStatusText');
    const advDetails = $('advancedKeySection');

    if (cloud.serverKeyConfigured) {
      badge.textContent = '☁️ 雲端 AI 已就緒';
      badge.classList.add('live');
      cloudBanner.classList.remove('demo-mode');
      cloudText.textContent = '✅ 雲端免金鑰 AI 辨識已啟用！您打開網址就能直接拍照辨識，完全不需要申請或設定 API Key。';
      advDetails.open = false;
    } else if (s.apiKey && s.apiKey.trim().length > 10) {
      badge.textContent = '✨ AI 辨識已啟用';
      badge.classList.add('live');
      cloudBanner.classList.remove('demo-mode');
      cloudText.textContent = '✅ 已啟用個人 Gemini API Key 辨識（若部署至 Cloudflare Pages 並設定 GEMINI_API_KEY，即可免金鑰給所有人用）。';
      advDetails.open = false;
    } else {
      badge.textContent = '🧪 模擬體驗模式';
      badge.classList.remove('live');
      cloudBanner.classList.add('demo-mode');
      cloudText.textContent = '🧪 體驗展示模式：可直接點首頁「模擬實拍體驗」試玩完整流程；若想實拍家中真實儀器，展開下方填入免費 Gemini API Key 即可立即啟用！';
      advDetails.open = true;
    }

    $('inputElderName').value = s.elderName || '';
    $('inputApiKey').value = s.apiKey || '';
    $('selectGeminiModel').value = s.geminiModel || 'auto';
    $('chkVoiceEnabled').checked = Boolean(s.voiceEnabled);
    $('selectVoiceRate').value = String(s.voiceRate || 0.88);
    $('chkFontXL').checked = Boolean(s.fontXL);
  }

  function switchView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === `view-${viewName}`);
    });
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    if (viewName === 'home') renderHome();
    if (viewName === 'history') renderHistory();
    if (viewName === 'doctor') renderDoctorView();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  async function refreshRecords() {
    state.records = await Storage.getAllRecords();
    renderHome();
    if (state.activeView === 'history') renderHistory();
    if (state.activeView === 'doctor') renderDoctorView();
  }

  function renderHome() {
    const now = Date.now();
    const coreTypes = ['blood_pressure', 'blood_glucose', 'oximeter', 'weight'];
    const todayTemp = state.records.find((r) => r.type === 'temperature' && Storage.isSameDay(r.timestamp, now));
    const displayTypes = todayTemp ? [...coreTypes, 'temperature'] : coreTypes;

    const cardsHtml = displayTypes
      .map((type) => {
        const info = Storage.DEVICE_TYPES[type];
        const todayRec = state.records.find((r) => r.type === type && Storage.isSameDay(r.timestamp, now));
        const latestRec = todayRec || state.records.find((r) => r.type === type);

        if (!todayRec) {
          const lastHint = latestRec
            ? `上次：${Storage.formatShortValue(latestRec)} (${Storage.formatDateTime(latestRec.timestamp)})`
            : '點擊即可拍照或輸入';
          return `
            <div class="metric-card" data-open-type="${type}">
              <div class="metric-top">
                <div class="metric-label">${info.icon} ${info.shortName}</div>
                <span class="status-pill empty">今日未量</span>
              </div>
              <div class="metric-value empty-val">尚未量測</div>
              <div class="metric-meta">${lastHint}</div>
            </div>
          `;
        }

        const st = Storage.evaluateRecord(todayRec);
        const subMeta =
          type === 'blood_pressure' && todayRec.values.pulse
            ? `心跳 ${todayRec.values.pulse} 次/分 · ${Storage.formatDateTime(todayRec.timestamp).split(' ')[1]}`
            : `${info.primaryUnit} · 今日 ${Storage.formatDateTime(todayRec.timestamp).split(' ')[1]}`;

        return `
          <div class="metric-card status-${st.level}" data-open-type="${type}">
            <div class="metric-top">
              <div class="metric-label">${info.icon} ${info.shortName}</div>
              <span class="status-pill ${st.level}">${st.label}</span>
            </div>
            <div class="metric-value">${Storage.formatShortValue(todayRec)}</div>
            <div class="metric-meta">${subMeta}</div>
          </div>
        `;
      })
      .join('');

    $('todayGrid').innerHTML = cardsHtml;
    $('todayGrid').querySelectorAll('.metric-card').forEach((card) => {
      card.addEventListener('click', () => {
        state.historyFilter = card.dataset.openType;
        switchView('history');
      });
    });

    renderRecordList($('homeRecentList'), state.records.slice(0, 5), true);
  }

  function renderRecordList(container, list, compact) {
    if (!list.length) {
      container.innerHTML = `<div class="card-box chart-empty">尚無健康紀錄，點擊上方「📷 拍儀器螢幕」開始記錄！</div>`;
      return;
    }

    container.innerHTML = list
      .map((r) => {
        const info = Storage.DEVICE_TYPES[r.type] || { icon: '📌', name: r.type };
        const st = Storage.evaluateRecord(r);
        const thumbHtml = r.thumbDataUrl
          ? `<img class="record-thumb" src="${r.thumbDataUrl}" alt="儀器原圖" data-view-photo="${r.id}"/>`
          : `<div class="record-thumb" aria-hidden="true">${info.icon}</div>`;

        return `
          <div class="record-item">
            ${thumbHtml}
            <div class="record-body">
              <div class="record-head">
                <span class="record-type-tag">${info.icon} ${info.name} <span class="status-pill ${st.level}" style="margin-left:4px;">${st.label}</span></span>
                <span class="record-time">${Storage.formatDateTime(r.timestamp)}</span>
              </div>
              <div class="record-reading">${Storage.formatReadingText(r)}</div>
              ${r.note ? `<div class="record-note">${escapeHtml(r.note)}</div>` : ''}
            </div>
            ${compact ? '' : `<button class="btn-delete-icon" title="刪除此筆" data-del-id="${r.id}">🗑️</button>`}
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('[data-view-photo]').forEach((img) => {
      img.addEventListener('click', () => {
        const rec = state.records.find((x) => x.id === img.dataset.viewPhoto);
        if (rec && rec.thumbDataUrl) {
          $('photoModalImg').src = rec.thumbDataUrl;
          $('photoModalCaption').textContent = `${Storage.formatDateTime(rec.timestamp)} · ${Storage.formatReadingText(rec)}`;
          $('photoModal').classList.add('open');
        }
      });
    });

    container.querySelectorAll('[data-del-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('確定要刪除這筆健康紀錄嗎？')) return;
        await Storage.deleteRecord(btn.dataset.delId);
        showToast('已刪除該筆紀錄');
        await refreshRecords();
      });
    });
  }

  function renderHistory() {
    const filter = state.historyFilter;
    $('historyFilterBar').querySelectorAll('.filter-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.filter === filter);
    });

    const statsCard = $('historyStatsCard');
    if (filter === 'all') {
      statsCard.classList.add('hidden');
      renderRecordList($('historyRecordList'), state.records, false);
      return;
    }

    statsCard.classList.remove('hidden');
    const info = Storage.DEVICE_TYPES[filter];
    $('historyChartTitle').textContent = `${info.icon} ${info.shortName}趨勢與統計（近 30 筆）`;

    const stats = ChartAndShare.computeStats(state.records, filter);
    $('statAvg').textContent = stats ? stats.avg : '-';
    $('statMax').textContent = stats ? stats.max : '-';
    $('statMin').textContent = stats ? stats.min : '-';

    ChartAndShare.renderTrendSVG($('trendChartWrap'), state.records, filter);
    renderRecordList($('historyRecordList'), state.records.filter((r) => r.type === filter), false);
  }

  function renderDoctorView() {
    const s = Storage.getSettings();
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recent14 = state.records.filter((r) => r.timestamp >= cutoff);

    $('doctorSummaryInfo').textContent = `對象：${s.elderName || '長輩'} ｜ 近 14 天共 ${recent14.length} 筆量測紀錄`;

    const tbody = $('doctorTableBody');
    if (!recent14.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#64748B;padding:24px;">近 14 天尚無量測紀錄</td></tr>`;
      return;
    }

    tbody.innerHTML = recent14
      .map((r) => {
        const info = Storage.DEVICE_TYPES[r.type] || { icon: '', shortName: r.type };
        const st = Storage.evaluateRecord(r);
        const cls = st.level === 'danger' ? 'val-danger' : st.level === 'warn' ? 'val-warn' : '';
        return `
          <tr>
            <td style="white-space:nowrap;">${Storage.formatDateTime(r.timestamp)}</td>
            <td style="white-space:nowrap;">${info.icon} ${info.shortName}</td>
            <td class="${cls}">${Storage.formatReadingText(r)}</td>
            <td><span class="status-pill ${st.level}">${st.label}</span></td>
          </tr>
        `;
      })
      .join('');
  }

  async function handlePhotoFile(file) {
    if (!file) return;
    openScanModalLoading('正在壓縮並辨識儀器螢幕...');
    try {
      const compressed = await AIVision.compressImageFile(file);
      const result = await AIVision.analyzePhoto(compressed, (statusMsg) => {
        $('scanLoadingText').textContent = statusMsg;
      });
      const isNoKey = result.mode === 'no_key';
      openScanModalConfirm({
        dataUrl: compressed.dataUrl,
        thumbDataUrl: compressed.thumbDataUrl,
        type: result.type,
        values: isNoKey ? createEmptyValues(result.type) : normalizeValues(result.type, result.values),
        mode: result.mode,
        note: result.note || '',
        needsRetake: result.needsRetake,
        rotation: 0,
        source: result.mode === 'gemini' ? 'camera-ai' : 'camera-manual'
      });
    } catch (err) {
      closeModal('scanModal');
      const rawMsg = String(err?.message || err);
      if (rawMsg.startsWith('PHOTO_UNREADABLE:')) {
        alert(rawMsg.replace('PHOTO_UNREADABLE:', ''));
      } else {
        alert(`辨識暫時失敗：${rawMsg}`);
      }
    }
  }

  function createEmptyValues(type) {
    const info = Storage.DEVICE_TYPES[type] || Storage.DEVICE_TYPES.blood_pressure;
    const out = {};
    info.fields.forEach((f) => { out[f.key] = ''; });
    if (info.extraSelect) out[info.extraSelect.key] = info.extraSelect.options[0].value;
    return out;
  }

  async function runDemoScan(deviceType) {
    closeModal('demoModal');
    openScanModalLoading('模擬拍照中，AI 自動分類辨識儀器螢幕...');
    await new Promise((r) => setTimeout(r, 650));
    const sample = AIVision.createMockMeterSample(deviceType);
    openScanModalConfirm({
      dataUrl: sample.dataUrl,
      thumbDataUrl: sample.thumbDataUrl,
      type: sample.result.type,
      values: normalizeValues(sample.result.type, sample.result.values),
      mode: 'demo',
      note: '模擬儀器拍照測試',
      needsRetake: false,
      rotation: 0,
      source: 'demo-camera'
    });
  }

  function openManualModal(defaultType) {
    const type = defaultType || 'blood_pressure';
    openScanModalConfirm({
      dataUrl: '',
      thumbDataUrl: '',
      type,
      values: normalizeValues(type, {}),
      mode: 'manual',
      note: '',
      needsRetake: false,
      rotation: 0,
      source: 'manual'
    });
  }

  function normalizeValues(type, raw) {
    const info = Storage.DEVICE_TYPES[type] || Storage.DEVICE_TYPES.blood_pressure;
    const out = {};
    info.fields.forEach((f) => {
      const val = raw && raw[f.key] !== undefined && raw[f.key] !== null ? Number(raw[f.key]) : f.defaultVal;
      out[f.key] = Number.isNaN(val) ? f.defaultVal : val;
    });
    if (info.extraSelect) {
      out[info.extraSelect.key] = (raw && raw[info.extraSelect.key]) || info.extraSelect.options[0].value;
    }
    return out;
  }

  function openScanModalLoading(msg) {
    $('scanModalTitle').textContent = 'AI 正在讀取螢幕...';
    $('scanLoadingBox').classList.remove('hidden');
    $('scanLoadingText').textContent = msg;
    $('scanConfirmBox').classList.add('hidden');
    $('scanModal').classList.add('open');
  }

  function openScanModalConfirm(draft) {
    state.draft = { rotation: 0, ...draft };
    $('scanLoadingBox').classList.add('hidden');
    $('scanConfirmBox').classList.remove('hidden');
    const sheet = $('scanModal').querySelector('.modal-sheet');
    if (sheet) sheet.scrollTop = 0;

    $('scanModalTitle').textContent =
      draft.mode === 'manual'
        ? '手動輸入健康數據'
        : draft.mode === 'no_key'
          ? '照片已拍好（尚未開啟 AI 辨識）'
          : '請核對辨識結果';

    if (draft.dataUrl) {
      $('scanPreviewBox').classList.remove('hidden');
      $('scanPreviewImg').src = draft.dataUrl;
      $('scanPreviewImg').style.transform = 'rotate(0deg)';
    } else {
      $('scanPreviewBox').classList.add('hidden');
    }

    const statusBox = $('aiStatusBox');
    statusBox.classList.toggle('demo-mode', draft.mode === 'demo' || draft.mode === 'no_key');
    const quickKeyBtn = $('btnQuickSetKey');
    const speakBtn = $('btnSpeakAgain');

    if (draft.mode === 'gemini') {
      $('aiStatusTitle').textContent = draft.needsRetake
        ? '⚠️ 螢幕略有反光，請特別核對下方數字'
        : `✅ ${draft.note || 'AI 已自動分類並讀出數值'}`;
      quickKeyBtn.classList.add('hidden');
      speakBtn.classList.remove('hidden');
    } else if (draft.mode === 'no_key') {
      $('aiStatusTitle').textContent =
        '⚠️ 尚未設定免費 Gemini API Key，目前無法自動讀取照片數字。您可對照上方照片手動輸入，或點下方按鈕 1 分鐘設定免費 Key 開啟真實 AI 辨識。';
      quickKeyBtn.classList.remove('hidden');
      speakBtn.classList.add('hidden');
    } else if (draft.mode === 'demo') {
      $('aiStatusTitle').textContent = '🧪 模擬儀器體驗模式';
      quickKeyBtn.classList.add('hidden');
      speakBtn.classList.remove('hidden');
    } else {
      $('aiStatusTitle').textContent = '✏️ 手動輸入模式（離線也可用）';
      quickKeyBtn.classList.add('hidden');
      speakBtn.classList.add('hidden');
    }

    $('confirmDeviceSelect').value = draft.type;
    $('confirmNoteInput').value = draft.note || '';
    renderDraftSteppers();

    if (Speech && Speech.speak) {
      const s = Storage.getSettings();
      if (draft.mode === 'gemini' || draft.mode === 'demo') {
        const sentence = Speech.buildConfirmSentence(draft.type, draft.values, s.elderName);
        Speech.speak(sentence);
      }
    }
  }

  function renderDraftSteppers() {
    const draft = state.draft;
    if (!draft) return;
    const info = Storage.DEVICE_TYPES[draft.type];

    let html = info.fields
      .map((f) => {
        const val = draft.values[f.key];
        const displayVal = val === '' || val === null || val === undefined ? '' : val;
        return `
          <div class="number-stepper">
            <div class="stepper-info">
              <div class="stepper-label">${f.label}</div>
              <div class="stepper-unit">${f.unit}</div>
            </div>
            <div class="stepper-controls">
              <button type="button" class="btn-step" data-step-key="${f.key}" data-step-dir="-1">−</button>
              <input type="number" step="${f.step}" class="stepper-input" data-input-key="${f.key}" value="${displayVal}" placeholder="${f.defaultVal}" />
              <button type="button" class="btn-step" data-step-key="${f.key}" data-step-dir="1">＋</button>
            </div>
          </div>
        `;
      })
      .join('');

    if (info.extraSelect) {
      const opts = info.extraSelect.options
        .map((o) => `<option value="${o.value}" ${draft.values[info.extraSelect.key] === o.value ? 'selected' : ''}>${o.label}</option>`)
        .join('');
      html += `
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">${info.extraSelect.label}</label>
          <select class="select-input" id="extraSelectField">${opts}</select>
        </div>
      `;
    }

    $('draftNumberGrid').innerHTML = html;

    $('draftNumberGrid').querySelectorAll('.btn-step').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.stepKey;
        const dir = Number(btn.dataset.stepDir);
        const f = info.fields.find((x) => x.key === key);
        const rawCur = draft.values[key];
        const cur = rawCur === '' || rawCur === null || rawCur === undefined ? f.defaultVal : Number(rawCur);
        let next = rawCur === '' ? f.defaultVal : cur + dir * f.step;
        next = Math.max(f.min, Math.min(f.max, next));
        next = f.step < 1 ? Number(next.toFixed(1)) : Math.round(next);
        draft.values[key] = next;
        const inp = $('draftNumberGrid').querySelector(`[data-input-key="${key}"]`);
        if (inp) inp.value = next;
      });
    });

    $('draftNumberGrid').querySelectorAll('.stepper-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.inputKey;
        draft.values[key] = inp.value === '' ? '' : Number(inp.value);
      });
    });

    const extraSel = $('extraSelectField');
    if (extraSel && info.extraSelect) {
      extraSel.addEventListener('change', () => {
        draft.values[info.extraSelect.key] = extraSel.value;
      });
    }
  }

  function closeModal(id) {
    $(id).classList.remove('open');
    if (id === 'scanModal' && Speech && Speech.stop) Speech.stop();
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $('modeBadge').addEventListener('click', () => switchView('settings'));

    $('btnGiantCamera').addEventListener('click', () => {
      $('cameraInput').value = '';
      $('cameraInput').click();
    });

    $('btnGalleryPick').addEventListener('click', () => {
      $('galleryInput').value = '';
      $('galleryInput').click();
    });

    $('cameraInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handlePhotoFile(f);
    });

    $('galleryInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handlePhotoFile(f);
    });

    $('btnManualEntry').addEventListener('click', () => openManualModal('blood_pressure'));
    $('btnDemoScan').addEventListener('click', () => $('demoModal').classList.add('open'));

    document.querySelectorAll('[data-demo-device]').forEach((btn) => {
      btn.addEventListener('click', () => runDemoScan(btn.dataset.demoDevice));
    });

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });

    $('confirmDeviceSelect').addEventListener('change', (e) => {
      if (!state.draft) return;
      state.draft.type = e.target.value;
      state.draft.values = state.draft.mode === 'no_key'
        ? createEmptyValues(state.draft.type)
        : normalizeValues(state.draft.type, {});
      renderDraftSteppers();
    });

    $('btnSpeakAgain').addEventListener('click', () => {
      if (!state.draft || !Speech || !Speech.speak) return;
      const s = Storage.getSettings();
      Speech.speak(Speech.buildConfirmSentence(state.draft.type, state.draft.values, s.elderName), s.voiceRate || 0.88);
    });

    $('btnQuickSetKey').addEventListener('click', () => {
      closeModal('scanModal');
      switchView('settings');
      $('advancedKeySection').open = true;
      $('inputApiKey').focus();
    });

    $('btnRotatePreview').addEventListener('click', () => {
      if (!state.draft) return;
      state.draft.rotation = ((state.draft.rotation || 0) + 90) % 360;
      $('scanPreviewImg').style.transform = `rotate(${state.draft.rotation}deg)`;
    });

    $('btnRetakePhoto').addEventListener('click', () => {
      closeModal('scanModal');
      if (state.draft && state.draft.mode === 'demo') {
        $('demoModal').classList.add('open');
      } else {
        $('cameraInput').value = '';
        $('cameraInput').click();
      }
    });

    $('btnConfirmSave').addEventListener('click', async () => {
      if (!state.draft) return;
      const info = Storage.DEVICE_TYPES[state.draft.type];
      const missingField = info.fields.find((f) => {
        if (f.key === 'bodyFat' || f.key === 'pulse') return false;
        const v = state.draft.values[f.key];
        return v === '' || v === null || v === undefined || Number.isNaN(Number(v)) || Number(v) <= 0;
      });
      if (missingField) {
        showToast(`請先輸入「${missingField.label}」數值再存檔！`);
        return;
      }

      const note = $('confirmNoteInput').value.trim();
      await Storage.addRecord({
        type: state.draft.type,
        values: state.draft.values,
        note,
        source: state.draft.source,
        thumbDataUrl: state.draft.thumbDataUrl
      });
      if (Speech && Speech.stop) Speech.stop();
      closeModal('scanModal');
      showToast('✅ 已成功存入今日健康紀錄！');
      const s = Storage.getSettings();
      if (s.voiceEnabled && Speech && Speech.speak) Speech.speak('已經幫您存好囉！');
      await refreshRecords();
      switchView('home');
    });

    $('historyFilterBar').querySelectorAll('.filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.historyFilter = chip.dataset.filter;
        renderHistory();
      });
    });

    $('btnShareLineCard').addEventListener('click', async () => {
      const s = Storage.getSettings();
      showToast('正在產生大字健康圖卡...');
      const blob = await ChartAndShare.generateShareCardBlob(state.records, s.elderName);
      const title = `${s.elderName || '長輩'}的健康量測紀錄`;
      const file = new File([blob], `拍拍健康記_${new Date().toISOString().slice(0, 10)}.png`, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title, text: '這是今天的健康儀器量測紀錄', files: [file] });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('已下載健康圖卡，可直接傳到 LINE 群組！');
    });

    $('btnCopyLineText').addEventListener('click', async () => {
      const s = Storage.getSettings();
      const text = ChartAndShare.buildLineSummaryText(state.records, s.elderName);
      try {
        await navigator.clipboard.writeText(text);
        showToast('📋 已複製文字摘要，打開 LINE 貼上即可！');
      } catch {
        prompt('請複製以下文字貼到 LINE：', text);
      }
    });

    $('btnTestApiKey').addEventListener('click', async () => {
      const key = $('inputApiKey').value.trim();
      const model = $('selectGeminiModel').value;
      if (key.length < 10) {
        showToast('請先在上方貼上 Gemini API Key！');
        return;
      }
      const btn = $('btnTestApiKey');
      btn.disabled = true;
      btn.textContent = '⏳ 測試連線中...';
      try {
        const res = await AIVision.testApiKey(key, model);
        Storage.saveSettings({ apiKey: key, geminiModel: model });
        applySettingsUI();
        showToast(`✅ 連線成功（使用 ${res.model}）！已啟用真實辨識`);
      } catch (err) {
        alert(`API Key 測試失敗：${err.message || err}`);
      } finally {
        btn.disabled = false;
        btn.textContent = '🧪 測試 Key 連線';
      }
    });

    $('btnSaveSettings').addEventListener('click', () => {
      Storage.saveSettings({
        elderName: $('inputElderName').value.trim() || '阿公／阿嬤',
        apiKey: $('inputApiKey').value.trim(),
        geminiModel: $('selectGeminiModel').value,
        voiceEnabled: $('chkVoiceEnabled').checked,
        voiceRate: Number($('selectVoiceRate').value) || 0.88,
        fontXL: $('chkFontXL').checked
      });
      applySettingsUI();
      showToast('✅ 設定已儲存！');
    });

    $('btnExportCsv').addEventListener('click', () => {
      if (!state.records.length) { showToast('目前沒有可匯出的紀錄'); return; }
      const csv = Storage.exportRecordsCSV(state.records);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `拍拍健康記_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('已匯出 Excel / CSV 健康紀錄檔');
    });

    $('btnClearSamples').addEventListener('click', async () => {
      await Storage.clearSampleRecords();
      await refreshRecords();
      showToast('已清除所有預設範例紀錄');
    });

    $('btnClearAll').addEventListener('click', async () => {
      if (!confirm('確定要清除「全部」健康紀錄嗎？此動作無法復原。')) return;
      await Storage.clearAllRecords();
      await refreshRecords();
      showToast('已清空所有健康紀錄');
    });

    // Android Chrome Install Prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      $('installBanner').classList.remove('hidden');
    });

    $('btnInstallPwa').addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      $('installBanner').classList.add('hidden');
    });

    // iOS Safari Add to Home Screen Tip
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone && !localStorage.getItem('snap_ios_tip_dismissed')) {
      $('iosInstallBanner').classList.remove('hidden');
    }
    $('btnCloseIosTip').addEventListener('click', () => {
      localStorage.setItem('snap_ios_tip_dismissed', '1');
      $('iosInstallBanner').classList.add('hidden');
    });
  }

  async function init() {
    bindEvents();
    await AIVision.checkCloudBackend();
    applySettingsUI();
    await Storage.seedInitialSamplesIfNeeded();
    await refreshRecords();

    if (
      'serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
