/* qr-scanner — client side QR decoding.
   Pass 1: jsQR over canvas pixels (small, fast, good enough for most screenshots).
   Pass 2: ZXing WebAssembly, loaded only when pass 1 misses (rotated, inverted, low contrast). */
(function () {
  'use strict';

  var MAX_SIDE = 1600;
  var drop = document.getElementById('drop');
  var fileInput = document.getElementById('file');
  var pickBtn = document.getElementById('pick');
  var pasteBtn = document.getElementById('paste');
  var result = document.getElementById('result');
  var zxingPromise = null;

  /* ---------------- helpers ---------------- */

  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That file could not be opened as an image.'));
      };
      img.src = url;
    });
  }

  function toPixels(img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    // white backdrop so transparent PNGs do not decode against black
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    var data = ctx.getImageData(0, 0, cw, ch);
    return { width: cw, height: ch, data: data.data, canvas: canvas };
  }

  function loadZXing() {
    if (zxingPromise) return zxingPromise;
    zxingPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'vendor/zxing-reader.js';
      s.async = true;
      s.onload = function () {
        if (!window.ZXingWASM) {
          reject(new Error('Decoder bundle loaded but did not initialise.'));
          return;
        }
        window.ZXingWASM.setZXingModuleOverrides({
          locateFile: function (path) {
            return path.indexOf('zxing_reader.wasm') !== -1 ? 'vendor/zxing_reader.wasm' : path;
          }
        });
        resolve(window.ZXingWASM);
      };
      s.onerror = function () {
        zxingPromise = null;
        reject(new Error('The WebAssembly decoder could not be downloaded.'));
      };
      document.head.appendChild(s);
    });
    return zxingPromise;
  }

  function classify(text) {
    if (/^https?:\/\//i.test(text)) return 'Web link';
    if (/^mailto:/i.test(text)) return 'Email address';
    if (/^tel:/i.test(text)) return 'Phone number';
    if (/^smsto:|^sms:/i.test(text)) return 'SMS';
    if (/^WIFI:/i.test(text)) return 'WiFi network';
    if (/^BEGIN:VCARD/i.test(text)) return 'Contact card';
    if (/^BEGIN:VEVENT/i.test(text)) return 'Calendar event';
    if (/^geo:/i.test(text)) return 'Location';
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(text)) return 'Email address';
    if (/^\d{8,}$/.test(text)) return 'Number';
    return 'Plain text';
  }

  /* ---------------- UI ---------------- */

  function clear() {
    result.className = 'result';
    result.innerHTML = '';
  }

  function busy(label) {
    result.className = 'result show';
    result.innerHTML = '<div class="card"><div class="card-head"><span class="tag">Working</span></div>' +
      '<p class="engine">' + label + '</p></div>';
  }

  function fail(message, detail) {
    result.className = 'result show';
    result.innerHTML = '<div class="card error"><div class="card-head"><span class="tag">Not decoded</span></div>' +
      '<div class="out" style="font-family:inherit">' + escapeHTML(message) + '</div>' +
      (detail ? '<p class="engine">' + escapeHTML(detail) + '</p>' : '') +
      '<div class="row"><button class="btn btn-ghost" type="button" id="retry">Try another image</button></div></div>';
    var retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', function () { fileInput.click(); });
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showResults(items, meta) {
    var first = items[0];
    var kind = classify(first.text);
    var isLink = /^https?:\/\//i.test(first.text);
    var rows = items.map(function (item, i) {
      return '<div class="out" data-idx="' + i + '">' + escapeHTML(item.text) + '</div>';
    }).join('');

    result.className = 'result show';
    result.innerHTML =
      '<div class="card">' +
        '<div class="card-head"><span class="tag ok">Decoded</span><span class="kind">' + escapeHTML(kind) +
          (items.length > 1 ? ' · ' + items.length + ' codes' : '') + '</span></div>' +
        '<div class="preview"><img alt="The image that was decoded" src="' + meta.thumb + '">' + rows + '</div>' +
        '<div class="row">' +
          '<button class="btn btn-primary" type="button" id="copy">' +
            '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M15 5H6a2 2 0 0 0-2 2v9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
            'Copy text</button>' +
          (isLink ? '<a class="btn btn-ghost" id="open" href="' + escapeHTML(first.text) + '" target="_blank" rel="noopener noreferrer">Open link</a>' : '') +
          '<button class="btn btn-ghost" type="button" id="save">Save as .txt</button>' +
        '</div>' +
        '<p class="engine">' + escapeHTML(meta.engine) + ' · ' + escapeHTML(meta.size) + ' · ' + meta.ms + ' ms</p>' +
      '</div>';

    var copyBtn = document.getElementById('copy');
    copyBtn.addEventListener('click', function () {
      var text = first.text;
      var done = function () {
        copyBtn.textContent = 'Copied';
        setTimeout(function () { copyBtn.textContent = 'Copy text'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
      } else {
        legacyCopy(text);
        done();
      }
    });

    document.getElementById('save').addEventListener('click', function () {
      var blob = new Blob([items.map(function (i) { return i.text; }).join('\n')], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qr-scanner.txt';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable */ }
    document.body.removeChild(ta);
  }

  /* ---------------- decode pipeline ---------------- */

  async function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(file.name || '')) {
      fail('That is not an image file. Drop a PNG, JPEG, WebP, GIF, AVIF, or SVG.');
      return;
    }

    var t0 = performance.now();
    busy('Reading the image');

    var img;
    try {
      img = await loadImage(file);
    } catch (err) {
      fail(err.message);
      return;
    }

    var px = toPixels(img);
    var meta = {
      thumb: px.canvas.toDataURL('image/png'),
      size: bytes(file.size) + ' file, ' + px.width + '×' + px.height + ' px',
      engine: '',
      ms: 0
    };

    // pass 1 — jsQR
    var found = null;
    if (window.jsQR) {
      try {
        var r = window.jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
        if (r && r.data) found = [{ text: r.data }];
      } catch (e) { /* fall through to wasm */ }
    }

    if (found) {
      meta.engine = 'jsQR';
      meta.ms = Math.round(performance.now() - t0);
      showResults(found, meta);
      return;
    }

    // pass 2 — ZXing WASM
    busy('First pass missed, loading the WebAssembly engine');
    var zx;
    try {
      zx = await loadZXing();
    } catch (err) {
      fail('This code could not be read by the fast decoder, and the fallback engine did not load.', err.message);
      return;
    }

    busy('Scanning with ZXing WebAssembly');
    try {
      var res = await zx.readBarcodes(
        { data: px.data, width: px.width, height: px.height, colorSpace: 'srgb' },
        { formats: ['QRCode'], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true }
      );
      if (res && res.length) {
        found = res.map(function (x) { return { text: x.text }; });
        meta.engine = 'ZXing WebAssembly';
        meta.ms = Math.round(performance.now() - t0);
        showResults(found, meta);
        return;
      }
    } catch (err) {
      fail('The fallback decoder failed on this image.', err.message);
      return;
    }

    meta.ms = Math.round(performance.now() - t0);
    fail(
      'No QR code found in this image.',
      'Tried both decoders, including inverted and rotated passes. Crop closer to the code, avoid glare, and try a sharper shot. (' + meta.size + ')'
    );
  }

  /* ---------------- camera ---------------- */

  var camBtn = document.getElementById('camera');
  var camPanel = document.getElementById('cam');
  var camVideo = document.getElementById('cam-video');
  var camStop = document.getElementById('cam-stop');
  var camNote = document.getElementById('cam-note');
  var camStream = null;
  var camLoop = null;

  function stopCamera() {
    if (camLoop) { cancelAnimationFrame(camLoop); camLoop = null; }
    if (camStream) {
      camStream.getTracks().forEach(function (t) { t.stop(); });
      camStream = null;
    }
    camVideo.srcObject = null;
    camPanel.hidden = true;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fail('This browser does not expose a camera to web pages.', 'Use Choose an image or paste a screenshot instead.');
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (err) {
      fail('Camera access was refused.', 'Allow the camera for this site, or decode a saved picture instead.');
      return;
    }
    camVideo.srcObject = camStream;
    camPanel.hidden = false;
    camNote.textContent = 'Looking for a code. Frames are decoded here, never sent.';
    await camVideo.play().catch(function () {});

    var scanCanvas = document.createElement('canvas');
    var scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
    var lastTry = 0;

    function tick(now) {
      camLoop = requestAnimationFrame(tick);
      if (now - lastTry < 120) return; // ~8 attempts per second keeps phones cool
      lastTry = now;
      var w = camVideo.videoWidth;
      var h = camVideo.videoHeight;
      if (!w || !h) return;
      var scale = Math.min(1, 720 / Math.max(w, h));
      scanCanvas.width = Math.round(w * scale);
      scanCanvas.height = Math.round(h * scale);
      scanCtx.drawImage(camVideo, 0, 0, scanCanvas.width, scanCanvas.height);
      var frame = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      if (!window.jsQR) return;
      var hit = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
      if (hit && hit.data) {
        stopCamera();
        var thumb = scanCanvas.toDataURL('image/png');
        showResults([{ text: hit.data }], { thumb: thumb, engine: 'jsQR (camera)', size: frame.width + '×' + frame.height + ' px frame', ms: 0 });
      }
    }
    camLoop = requestAnimationFrame(tick);
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    camBtn.hidden = false;
  }
  camBtn.addEventListener('click', startCamera);
  camStop.addEventListener('click', stopCamera);
  window.addEventListener('pagehide', stopCamera);

  /* ---------------- wiring ---------------- */

  pickBtn.addEventListener('click', function () { fileInput.click(); });
  pasteBtn.addEventListener('click', async function () {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      fail('This browser does not let a page read the clipboard. Use Choose an image, or press Ctrl and V.');
      return;
    }
    try {
      var items = await navigator.clipboard.read();
      for (var i = 0; i < items.length; i++) {
        var types = items[i].types || [];
        for (var j = 0; j < types.length; j++) {
          if (/^image\//.test(types[j])) {
            var blob = await items[i].getType(types[j]);
            handleFile(new File([blob], 'clipboard.' + types[j].split('/')[1], { type: types[j] }));
            return;
          }
        }
      }
      fail('The clipboard has no image in it. Copy a screenshot first.');
    } catch (err) {
      fail('Clipboard access was refused.', 'Use Choose an image instead, or press Ctrl and V.');
    }
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    drop.addEventListener(evt, function (e) {
      e.preventDefault();
      drop.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    drop.addEventListener(evt, function (e) {
      e.preventDefault();
      if (evt === 'dragleave' && drop.contains(e.relatedTarget)) return;
      drop.classList.remove('is-over');
    });
  });
  drop.addEventListener('drop', function (e) {
    var dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) handleFile(dt.files[0]);
  });

  window.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) { handleFile(f); e.preventDefault(); return; }
      }
    }
  });

  // keep the page from navigating away when a file is dropped outside the zone
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* offline mode is a bonus; the decoder still works without it */
      });
    });
  }

  /* ---------------- mobile menu ---------------- */

  var navToggle = document.getElementById('nav-toggle');
  var menu = document.getElementById('mobile-menu');

  function setMenu(open) {
    menu.classList.toggle('open', open);
    menu.setAttribute('aria-hidden', open ? 'false' : 'true');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  if (navToggle && menu) {
    navToggle.addEventListener('click', function () {
      setMenu(!menu.classList.contains('open'));
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('open')) {
        setMenu(false);
        navToggle.focus();
      }
    });
    window.matchMedia('(min-width: 720px)').addEventListener('change', function (e) {
      if (e.matches) setMenu(false);
    });
  }

  /* ---------------- scroll reveals + tagline ---------------- */

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  // tagline: wrap words, light them one at a time
  var tagline = document.getElementById('tagline');
  if (tagline) {
    var words = tagline.textContent.trim().split(/\s+/);
    tagline.textContent = '';
    words.forEach(function (word, i) {
      var span = document.createElement('span');
      span.className = 'w';
      span.textContent = word;
      tagline.appendChild(span);
      if (i < words.length - 1) tagline.appendChild(document.createTextNode(' '));
    });

    var spans = tagline.querySelectorAll('.w');
    if (reduce || !('IntersectionObserver' in window)) {
      spans.forEach(function (s) { s.classList.add('on'); });
    } else {
      var wordIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('on');
            wordIO.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -30% 0px', threshold: 0 });
      spans.forEach(function (s) { wordIO.observe(s); });
    }
  }
})();
