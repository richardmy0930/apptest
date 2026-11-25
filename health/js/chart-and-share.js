/**
 * 拍拍健康記 — 離線純 SVG 趨勢圖表 ＆ LINE 家庭群組分享圖卡產生器
 */
(function () {
  window.SnapHealth = window.SnapHealth || {};

  /**
   * 繪製純 SVG 趨勢折線圖（無外部套件依賴，離線也能正常呈現）
   */
  function renderTrendSVG(container, records, type) {
    const filtered = records
      .filter((r) => r.type === type)
      .slice(0, 14)
      .reverse();

    if (filtered.length < 2) {
      container.innerHTML = `<div class="chart-empty">此項目累積滿 2 筆紀錄後，這裡會自動顯示趨勢折線圖 📈</div>`;
      return;
    }

    const width = 440;
    const height = 210;
    const padL = 44;
    const padR = 20;
    const padT = 22;
    const padB = 34;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    let series = [];
    if (type === 'blood_pressure') {
      series = [
        { name: '收縮壓', color: '#DC2626', pts: filtered.map((r) => Number(r.values.systolic) || 0) },
        { name: '舒張壓', color: '#0F766E', pts: filtered.map((r) => Number(r.values.diastolic) || 0) }
      ];
    } else if (type === 'blood_glucose') {
      series = [{ name: '血糖', color: '#EA580C', pts: filtered.map((r) => Number(r.values.glucose) || 0) }];
    } else if (type === 'oximeter') {
      series = [{ name: '血氧 %', color: '#0284C7', pts: filtered.map((r) => Number(r.values.spo2) || 0) }];
    } else if (type === 'weight') {
      series = [{ name: '體重 kg', color: '#7C3AED', pts: filtered.map((r) => Number(r.values.weight) || 0) }];
    } else if (type === 'temperature') {
      series = [{ name: '體溫 °C', color: '#E11D48', pts: filtered.map((r) => Number(r.values.temperature) || 0) }];
    }

    const allVals = series.flatMap((s) => s.pts).filter((n) => !Number.isNaN(n));
    let minV = Math.min(...allVals);
    let maxV = Math.max(...allVals);
    if (minV === maxV) {
      minV -= 5;
      maxV += 5;
    } else {
      const margin = (maxV - minV) * 0.16;
      minV = Math.floor(minV - margin);
      maxV = Math.ceil(maxV + margin);
    }

    const xAt = (i) => padL + (filtered.length === 1 ? plotW / 2 : (i / (filtered.length - 1)) * plotW);
    const yAt = (v) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;

    // Horizontal grid lines (3 levels)
    const ticks = [minV, Math.round((minV + maxV) / 2), maxV];
    const gridHtml = ticks
      .map((t) => {
        const y = yAt(t).toFixed(1);
        return `
          <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#E2E8F0" stroke-width="1.5" stroke-dasharray="4 4"/>
          <text x="${padL - 8}" y="${Number(y) + 5}" text-anchor="end" font-size="13" font-weight="700" fill="#64748B">${t}</text>
        `;
      })
      .join('');

    // X-axis date labels (first, middle, last)
    const labelIdx = new Set([0, Math.floor((filtered.length - 1) / 2), filtered.length - 1]);
    const xLabelsHtml = Array.from(labelIdx)
      .map((i) => {
        const d = new Date(filtered[i].timestamp);
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        return `<text x="${xAt(i).toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="#64748B">${label}</text>`;
      })
      .join('');

    const seriesHtml = series
      .map((s) => {
        const points = s.pts.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
        const dots = s.pts
          .map((v, i) => {
            const cx = xAt(i).toFixed(1);
            const cy = yAt(v).toFixed(1);
            return `<circle cx="${cx}" cy="${cy}" r="5" fill="#FFFFFF" stroke="${s.color}" stroke-width="3"/>`;
          })
          .join('');
        return `
          <polyline fill="none" stroke="${s.color}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" points="${points}"/>
          ${dots}
        `;
      })
      .join('');

    const legendHtml = series
      .map(
        (s) =>
          `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:14px;font-weight:700;color:#334155;">
            <span style="width:12px;height:12px;border-radius:99px;background:${s.color};display:inline-block;"></span>${s.name}
          </span>`
      )
      .join('');

    container.innerHTML = `
      <div style="margin-bottom:6px;">${legendHtml}</div>
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block;">
        ${gridHtml}
        ${seriesHtml}
        ${xLabelsHtml}
      </svg>
    `;
  }

  /**
   * 計算特定儀器類型的平均、最高、最低值
   */
  function computeStats(records, type) {
    const filtered = records.filter((r) => r.type === type).slice(0, 30);
    if (!filtered.length) return null;

    if (type === 'blood_pressure') {
      const sysArr = filtered.map((r) => Number(r.values.systolic) || 0);
      const diaArr = filtered.map((r) => Number(r.values.diastolic) || 0);
      const avgS = Math.round(sysArr.reduce((a, b) => a + b, 0) / sysArr.length);
      const avgD = Math.round(diaArr.reduce((a, b) => a + b, 0) / diaArr.length);
      return {
        avg: `${avgS}/${avgD}`,
        max: `${Math.max(...sysArr)}/${Math.max(...diaArr)}`,
        min: `${Math.min(...sysArr)}/${Math.min(...diaArr)}`
      };
    }

    const keyMap = {
      blood_glucose: 'glucose',
      oximeter: 'spo2',
      weight: 'weight',
      temperature: 'temperature'
    };
    const key = keyMap[type];
    const nums = filtered.map((r) => Number(r.values[key])).filter((n) => !Number.isNaN(n) && n > 0);
    if (!nums.length) return null;
    const isFloat = type === 'weight' || type === 'temperature';
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return {
      avg: isFloat ? avg.toFixed(1) : String(Math.round(avg)),
      max: isFloat ? Math.max(...nums).toFixed(1) : String(Math.max(...nums)),
      min: isFloat ? Math.min(...nums).toFixed(1) : String(Math.min(...nums))
    };
  }

  /**
   * 產生適合直接丟進 LINE 家庭群組的純文字健康摘要
   */
  function buildLineSummaryText(records, elderName) {
    const Storage = window.SnapHealth.Storage;
    const latest = records.slice(0, 8);
    const todayStr = new Date().toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const lines = [
      `📋【${elderName || '家人'}的健康紀錄摘要】`,
      `更新日期：${todayStr}`,
      '————————————'
    ];
    if (!latest.length) {
      lines.push('目前尚無量測紀錄。');
    } else {
      latest.forEach((r) => {
        const info = Storage.DEVICE_TYPES[r.type] || { icon: '📌', shortName: r.type };
        const st = Storage.evaluateRecord(r);
        lines.push(`${info.icon} ${Storage.formatDateTime(r.timestamp)}｜${info.shortName}：${Storage.formatReadingText(r)}（${st.label}）`);
      });
    }
    lines.push('————————————');
    lines.push('由「拍拍健康記」整理（僅供日常紀錄參考）');
    return lines.join('\n');
  }

  /**
   * 用 Canvas 繪製高解析度大字體「健康回報圖卡」PNG，方便 Android 直接一鍵分享到 LINE
   */
  function generateShareCardBlob(records, elderName) {
    const Storage = window.SnapHealth.Storage;
    const recent = records.slice(0, 6);
    const cardW = 860;
    const rowH = 104;
    const cardH = 260 + Math.max(1, recent.length) * rowH + 90;

    const canvas = document.createElement('canvas');
    canvas.width = cardW;
    canvas.height = cardH;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#F3F6F4';
    ctx.fillRect(0, 0, cardW, cardH);

    // Top Header Banner
    ctx.fillStyle = '#0F766E';
    ctx.fillRect(0, 0, cardW, 185);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 44px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    ctx.fillText(`📋 ${elderName || '長輩'}的健康量測紀錄`, 46, 86);

    const todayStr = new Date().toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    });
    ctx.font = '600 28px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = '#CCFBF1';
    ctx.fillText(`整理日期：${todayStr}`, 46, 142);

    // Rows
    let y = 216;
    if (!recent.length) {
      ctx.fillStyle = '#64748B';
      ctx.font = '600 32px sans-serif';
      ctx.fillText('目前尚未有健康量測紀錄', 46, y + 60);
    } else {
      recent.forEach((r) => {
        const info = Storage.DEVICE_TYPES[r.type] || { icon: '📌', shortName: r.type };
        const st = Storage.evaluateRecord(r);

        // Card row
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(36, y, cardW - 72, rowH - 16);

        // Left status bar
        ctx.fillStyle = st.level === 'danger' ? '#DC2626' : st.level === 'warn' ? '#D97706' : '#16A34A';
        ctx.fillRect(36, y, 12, rowH - 16);

        // Label + Date
        ctx.fillStyle = '#0F766E';
        ctx.font = 'bold 28px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
        ctx.fillText(`${info.icon} ${info.shortName}`, 68, y + 36);

        ctx.fillStyle = '#64748B';
        ctx.font = '600 24px sans-serif';
        ctx.fillText(Storage.formatDateTime(r.timestamp), 280, y + 36);

        // Reading
        ctx.fillStyle = '#111827';
        ctx.font = 'bold 32px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
        ctx.fillText(Storage.formatReadingText(r), 68, y + 76);

        // Status pill text
        ctx.fillStyle = st.level === 'danger' ? '#B91C1C' : st.level === 'warn' ? '#B45309' : '#15803D';
        ctx.font = 'bold 26px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(st.label, cardW - 56, y + 56);
        ctx.textAlign = 'left';

        y += rowH;
      });
    }

    // Footer
    ctx.fillStyle = '#64748B';
    ctx.font = '600 22px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    ctx.fillText('拍拍健康記 — 免藍牙跨儀器拍照紀錄（僅供日常記錄，非醫療診斷）', 46, cardH - 36);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png', 0.95);
    });
  }

  window.SnapHealth.ChartAndShare = {
    renderTrendSVG,
    computeStats,
    buildLineSummaryText,
    generateShareCardBlob
  };
})();
