/**
 * 拍拍健康記 — 銀髮族中文語音播報模組（Web Speech API）
 */
(function () {
  window.SnapHealth = window.SnapHealth || {};

  function isSupported() {
    return typeof window !== 'undefined' && (Boolean(window.AndroidTTS) || 'speechSynthesis' in window);
  }

  function pickChineseVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    return (
      voices.find((v) => /zh[-_]TW/i.test(v.lang)) ||
      voices.find((v) => /zh/i.test(v.lang)) ||
      null
    );
  }

  function stop() {
    if (typeof window !== 'undefined' && window.AndroidTTS) {
      try { window.AndroidTTS.stop(); } catch {}
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  function speak(text, rateOverride) {
    if (!isSupported() || !text) return;
    const settings = window.SnapHealth.Storage.getSettings();
    if (!settings.voiceEnabled && rateOverride === undefined) return;

    const rate = rateOverride || settings.voiceRate || 0.88;
    stop();

    // Prefer native Android TTS when running inside Android APK
    if (typeof window !== 'undefined' && window.AndroidTTS) {
      try {
        window.AndroidTTS.speak(text, rate);
        return;
      } catch {}
    }

    if ('speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-TW';
      utter.rate = rate;
      utter.pitch = 1.0;
      const voice = pickChineseVoice();
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    }
  }

  function buildConfirmSentence(type, values, elderName) {
    const prefix = elderName && elderName !== '阿公／阿嬤' ? `${elderName}，` : '';
    const v = values || {};
    switch (type) {
      case 'blood_pressure':
        return `${prefix}辨識完成，血壓計，高壓 ${v.systolic}，低壓 ${v.diastolic}，心跳 ${v.pulse || '未顯示'}。確認無誤請按綠色按鈕存檔。`;
      case 'blood_glucose': {
        const meal = v.mealTiming === 'fasting' ? '飯前' : v.mealTiming === 'postprandial' ? '飯後' : '';
        return `${prefix}辨識完成，${meal}血糖 ${v.glucose}。確認無誤請按綠色按鈕存檔。`;
      }
      case 'oximeter':
        return `${prefix}辨識完成，血氧濃度百分之 ${v.spo2}，心律 ${v.pulse || '未顯示'}。確認無誤請按綠色按鈕存檔。`;
      case 'weight':
        return `${prefix}辨識完成，體重 ${v.weight} 公斤${Number(v.bodyFat) > 0 ? `，體脂率百分之 ${v.bodyFat}` : ''}。確認無誤請按綠色按鈕存檔。`;
      case 'temperature':
        return `${prefix}辨識完成，體溫 ${v.temperature} 度。確認無誤請按綠色按鈕存檔。`;
      default:
        return `${prefix}辨識完成，請確認數字後按綠色按鈕存檔。`;
    }
  }

  // Warm up voice list on browsers that support Web Speech API
  if (
    typeof window !== 'undefined' &&
    window.speechSynthesis &&
    typeof window.speechSynthesis.onvoiceschanged !== 'undefined'
  ) {
    window.speechSynthesis.onvoiceschanged = () => pickChineseVoice();
  }

  window.SnapHealth.Speech = {
    isSupported,
    speak,
    stop,
    buildConfirmSentence
  };
})();
