// Dźwięki do snu generowane w aplikacji (bez plików audio, działa offline).
// Każdy dźwięk to 20-sekundowa pętla bez słyszalnego szwu, odtwarzana przez element <audio>,
// dzięki czemu gra dalej przy wygaszonym ekranie.
var SleepSounds = (function () {
  var RATE = 22050, SECONDS = 20, N = RATE * SECONDS, FADE = RATE; // 1 s przenikania na styku pętli
  var urls = {};
  var audio = null, currentId = null, stopTimer = null, fadeTimer = null, onChange = function () {};

  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  }

  function pinkFill(out, r, gain) {
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < out.length; i++) {
      var w = r();
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      out[i] += (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * gain;
      b6 = w * 0.115926;
    }
  }
  function brownFill(out, r, gain, smooth) {
    var last = 0, k = smooth || 0.02;
    for (var i = 0; i < out.length; i++) {
      last = (last + k * r()) / (1 + k);
      out[i] += last * 3.5 * gain;
    }
  }

  // Raw signal of N + FADE samples, so the loop can cross-fade its end into its start.
  function raw(id) {
    var M = N + FADE, out = new Float32Array(M), r = rng(9301 + id.charCodeAt(0) * 49297);
    var i, t;
    if (id === "white") {
      for (i = 0; i < M; i++) out[i] = r() * 0.5;
    } else if (id === "pink") {
      pinkFill(out, r, 1);
    } else if (id === "brown") {
      brownFill(out, r, 1);
    } else if (id === "rain") {
      // Soft hiss plus many small drops.
      var hiss = new Float32Array(M); pinkFill(hiss, r, 1);
      var lp = 0;
      for (i = 0; i < M; i++) { lp += 0.15 * (hiss[i] - lp); out[i] = (hiss[i] - lp) * 0.9 + lp * 0.35; }
      var drops = Math.floor(SECONDS * 55);
      for (var d = 0; d < drops; d++) {
        var start = Math.floor((r() * 0.5 + 0.5) * (M - 400)), amp = 0.05 + (r() * 0.5 + 0.5) * 0.22, prev = 0;
        for (var j = 0; j < 300; j++) {
          var n = r() * amp * Math.exp(-j / 45);
          out[start + j] += n - prev * 0.6; prev = n;
        }
      }
    } else if (id === "ocean") {
      // Brown noise with slow swells: two waves per loop (10 s period), so the loop stays seamless.
      var base = new Float32Array(M); brownFill(base, r, 1, 0.03);
      var foam = new Float32Array(M); pinkFill(foam, r, 1);
      for (i = 0; i < M; i++) {
        t = (i % N) / RATE;
        var phase = (t % 10) / 10;
        var swell = phase < 0.6 ? Math.sin(Math.PI / 2 * phase / 0.6) : Math.cos(Math.PI / 2 * (phase - 0.6) / 0.4);
        swell = swell * swell;
        out[i] = base[i] * (0.25 + 0.75 * swell) + foam[i] * 0.35 * swell * swell;
      }
    } else if (id === "fan") {
      // Low rumble with a faint motor hum (whole number of cycles per loop).
      brownFill(out, r, 0.8, 0.04);
      var lpf = 0, tmp = new Float32Array(M); pinkFill(tmp, r, 1);
      for (i = 0; i < M; i++) {
        lpf += 0.08 * (tmp[i] - lpf);
        t = (i % N) / RATE;
        out[i] += lpf * 0.5 + Math.sin(2 * Math.PI * 100 * t) * 0.012 + Math.sin(2 * Math.PI * 200 * t) * 0.006;
      }
    }
    return out;
  }

  function loop(id) {
    var a = raw(id), out = new Float32Array(N), i;
    for (i = 0; i < N; i++) out[i] = a[i];
    for (i = 0; i < FADE; i++) {               // equal-power cross-fade: end of signal flows into the start
      var w = Math.sin(Math.PI / 2 * i / FADE);
      out[i] = a[i] * w + a[N + i] * Math.cos(Math.PI / 2 * i / FADE);
    }
    var sum = 0;                                // even out loudness between sounds
    for (i = 0; i < N; i++) sum += out[i] * out[i];
    var rms = Math.sqrt(sum / N) || 1, g = 0.16 / rms;
    for (i = 0; i < N; i++) { var v = out[i] * g; out[i] = v > 0.98 ? 0.98 : v < -0.98 ? -0.98 : v; }
    return out;
  }

  function wav(samples) {
    var buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf), p = 0;
    function s(str) { for (var k = 0; k < str.length; k++) v.setUint8(p++, str.charCodeAt(k)); }
    function u32(x) { v.setUint32(p, x, true); p += 4; }
    function u16(x) { v.setUint16(p, x, true); p += 2; }
    s("RIFF"); u32(36 + samples.length * 2); s("WAVE"); s("fmt "); u32(16); u16(1); u16(1);
    u32(RATE); u32(RATE * 2); u16(2); u16(16); s("data"); u32(samples.length * 2);
    for (var i = 0; i < samples.length; i++) { v.setInt16(p, samples[i] * 32767, true); p += 2; }
    return new Blob([buf], { type: "audio/wav" });
  }

  function urlFor(id) {
    if (!urls[id]) urls[id] = URL.createObjectURL(wav(loop(id)));
    return urls[id];
  }

  function clearTimers() {
    if (stopTimer) clearTimeout(stopTimer);
    if (fadeTimer) clearInterval(fadeTimer);
    stopTimer = fadeTimer = null;
  }

  function stop() {
    clearTimers();
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    audio = null; currentId = null;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
    onChange();
  }

  function play(id, title, artist) {
    stop();
    audio = new Audio(urlFor(id));
    audio.loop = true;
    audio.volume = 1;
    currentId = id;
    var p = audio.play();
    if (p && p.catch) p.catch(function () { stop(); });
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: title, artist: artist, artwork: [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }] });
        navigator.mediaSession.setActionHandler("pause", stop);
        navigator.mediaSession.setActionHandler("stop", stop);
        navigator.mediaSession.playbackState = "playing";
      } catch (e) {}
    }
    onChange();
  }

  // Stops after the given minutes, with a gentle 30-second fade at the end. 0 = no timer.
  function setTimer(minutes) {
    clearTimers();
    if (audio) audio.volume = 1;
    if (!minutes) return;
    var fadeMs = 30000;
    stopTimer = setTimeout(function () {
      var steps = 60, k = 0;
      fadeTimer = setInterval(function () {
        k++;
        if (audio) audio.volume = Math.max(0, 1 - k / steps);
        if (k >= steps) stop();
      }, fadeMs / steps);
    }, Math.max(0, minutes * 60000 - fadeMs));
  }

  return {
    ids: ["white", "pink", "brown", "rain", "ocean", "fan"],
    play: play, stop: stop, setTimer: setTimer,
    current: function () { return currentId; },
    onChange: function (fn) { onChange = fn; }
  };
})();
