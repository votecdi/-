
/* No Boat No Vote - DP Maker (BG Remove OFF: photo shows only in frame's transparent area) */

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: true });

const fileInput = document.getElementById("file");
const zoomEl = document.getElementById("zoom");
const zoomText = document.getElementById("zoomText");
const btnDownload = document.getElementById("download");
const btnShare = document.getElementById("share");
const btnFit = document.getElementById("fit");
const qualityEl = document.getElementById("quality");
const qText = document.getElementById("qText");
const frameListEl = document.getElementById("frames");
const frameUpload = document.getElementById("frameUpload");
const toastEl = document.getElementById("toast");
const installBtn = document.getElementById("install");

const LOGO_SRC = "logo.png";

// ---- state ----
let userImg = null;
let userImgURL = null;

let frameImg = new Image();
frameImg.decoding = "async";
frameImg.crossOrigin = "anonymous";

let logoImg = new Image();
logoImg.decoding = "async";
logoImg.crossOrigin = "anonymous";
logoImg.src = LOGO_SRC;

let zoom = 1;
let offsetX = 0; // in canvas px
let offsetY = 0;

let isDragging = false;
let lastX = 0;
let lastY = 0;
let rafPending = false;

// Offscreen caches (scaled to current export/preview size)
let frameCanvas = document.createElement("canvas");
let frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });

let holeMaskCanvas = document.createElement("canvas"); // alpha=1 where hole exists
let holeMaskCtx = holeMaskCanvas.getContext("2d", { willReadFrequently: true });

let holeBBox = { x: 0, y: 0, w: canvas.width, h: canvas.height };

// Frames (built-in)
const builtInFrames = [
  { id: "f1", name: "Green", src: "frame1.png", thumb: "frame1_thumb.png" },
  { id: "f2", name: "Red", src: "frame2.png", thumb: "frame2_thumb.png" },
];

// Custom frames stored as dataURL in localStorage
const LS_KEY = "dp_maker_custom_frames_v1";

function loadCustomFrames() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && x.src && x.thumb).slice(0, 6);
  } catch {
    return [];
  }
}

function saveCustomFrames(arr) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, 6)));
  } catch {}
}

let frames = [...builtInFrames, ...loadCustomFrames()];
let selectedFrameId = frames[0]?.id || "f1";

// ---- helpers ----
function showToast(msg) {
  if (!msg) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function dataURLFromFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function imageFromURL(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}

function scheduleDraw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    draw();
  });
}

// ---- frame list UI ----
function renderFrameList() {
  frameListEl.innerHTML = "";
  frames.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frameItem" + (f.id === selectedFrameId ? " active" : "");
    btn.setAttribute("role", "listitem");
    btn.title = f.name || "Frame";
    const img = document.createElement("img");
    img.alt = f.name || "Frame";
    img.src = f.thumb || f.src;
    btn.appendChild(img);
    btn.addEventListener("click", () => selectFrame(f.id));
    frameListEl.appendChild(btn);
  });
}

function selectFrame(id) {
  const found = frames.find((f) => f.id === id);
  if (!found) return;
  selectedFrameId = id;
  renderFrameList();
  loadFrame(found.src);
}

// ---- build mask from frame alpha ----
// We want a mask where photo is visible only in transparent pixels of the frame.
// Create mask alpha = (255 - frameAlpha) and rgb white.
function buildHoleMaskAndBBox() {
  const w = canvas.width;
  const h = canvas.height;

  // draw scaled frame on offscreen
  frameCanvas.width = w;
  frameCanvas.height = h;
  frameCtx.clearRect(0, 0, w, h);
  frameCtx.drawImage(frameImg, 0, 0, w, h);

  const frameData = frameCtx.getImageData(0, 0, w, h);
  const d = frameData.data;

  // mask canvas
  holeMaskCanvas.width = w;
  holeMaskCanvas.height = h;
  const maskData = holeMaskCtx.createImageData(w, h);
  const m = maskData.data;

  // bbox scan for pixels where holeAlpha > 0
  let minX = w, minY = h, maxX = 0, maxY = 0;
  let any = false;

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]; // frame alpha
    const holeA = 255 - a; // transparent area => visible
    m[i] = 255; m[i + 1] = 255; m[i + 2] = 255; m[i + 3] = holeA;

    if (holeA > 5) {
      any = true;
      const px = ((i / 4) % w) | 0;
      const py = ((i / 4) / w) | 0;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }

  holeMaskCtx.putImageData(maskData, 0, 0);

  if (any) {
    // add a small padding for nicer fit
    const pad = Math.round(Math.min(w, h) * 0.01);
    holeBBox = {
      x: clamp(minX - pad, 0, w),
      y: clamp(minY - pad, 0, h),
      w: clamp(maxX - minX + 2 * pad, 1, w),
      h: clamp(maxY - minY + 2 * pad, 1, h),
    };
  } else {
    holeBBox = { x: 0, y: 0, w, h };
  }
}

function fitToHole() {
  if (!userImg) return;

  // cover fit inside hole box
  const w = canvas.width;
  const h = canvas.height;

  const box = holeBBox;
  const boxCx = box.x + box.w / 2;
  const boxCy = box.y + box.h / 2;

  const scaleX = box.w / userImg.width;
  const scaleY = box.h / userImg.height;
  // cover: choose max
  zoom = Math.max(scaleX, scaleY);

  // ensure within slider limits
  zoom = clamp(zoom, parseFloat(zoomEl.min), parseFloat(zoomEl.max));

  // center: offsets so that image center equals box center
  offsetX = boxCx;
  offsetY = boxCy;

  zoomEl.value = String(zoom);
  zoomText.textContent = `${zoom.toFixed(2)}x`;

  scheduleDraw();
}

// ---- rendering ----
function drawPhotoMasked(targetCtx, targetCanvas) {
  if (!userImg) return;

  const w = targetCanvas.width;
  const h = targetCanvas.height;

  // draw photo on temp canvas
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");

  // transform: image drawn with center at (offsetX, offsetY)
  tctx.save();
  tctx.translate(offsetX, offsetY);
  tctx.scale(zoom, zoom);
  tctx.translate(-userImg.width / 2, -userImg.height / 2);
  tctx.drawImage(userImg, 0, 0);
  tctx.restore();

  // apply hole mask (destination-in)
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(holeMaskCanvas, 0, 0, w, h);
  tctx.globalCompositeOperation = "source-over";

  // paint to target
  targetCtx.drawImage(tmp, 0, 0);
}

function draw() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (userImg) {
    drawPhotoMasked(ctx, canvas);
  }

  // frame on top
  if (frameImg && frameImg.complete) {
    ctx.drawImage(frameImg, 0, 0, w, h);
  }
}

function drawExport(mode) {
  const size = parseInt(qualityEl.value || "1080", 10);
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const octx = out.getContext("2d");

  // draw photo masked (need scaled mask)
  const prevW = canvas.width;
  const prevH = canvas.height;

  // build scaled frame & mask for export size (cheap; only on export)
  const f = document.createElement("canvas");
  f.width = size; f.height = size;
  const fctx = f.getContext("2d", { willReadFrequently: true });
  fctx.drawImage(frameImg, 0, 0, size, size);

  const frameData = fctx.getImageData(0, 0, size, size);
  const d = frameData.data;

  const mcan = document.createElement("canvas");
  mcan.width = size; mcan.height = size;
  const mctx = mcan.getContext("2d");
  const mdata = mctx.createImageData(size, size);
  const md = mdata.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    const holeA = 255 - a;
    md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = holeA;
  }
  mctx.putImageData(mdata, 0, 0);

  // draw photo to temp at export size
  const tmp = document.createElement("canvas");
  tmp.width = size; tmp.height = size;
  const tctx = tmp.getContext("2d");
  // scale offsets from preview to export
  const sx = size / prevW;
  const sy = size / prevH;

  tctx.save();
  tctx.translate(offsetX * sx, offsetY * sy);
  tctx.scale(zoom * sx, zoom * sy); // isotropic since square
  tctx.translate(-userImg.width / 2, -userImg.height / 2);
  tctx.drawImage(userImg, 0, 0);
  tctx.restore();

  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(mcan, 0, 0, size, size);
  tctx.globalCompositeOperation = "source-over";

  // compose
  octx.clearRect(0, 0, size, size);
  octx.drawImage(tmp, 0, 0);
  octx.drawImage(f, 0, 0);

  // watermark logo
  const logo = logoImg && logoImg.complete ? logoImg : null;
  if (logo) {
    const margin = Math.round(size * 0.045);
    const logoSize = Math.round(size * 0.14);

    if (mode === "download") {
      // top-left
      octx.drawImage(logo, margin, margin, logoSize, logoSize);
    } else if (mode === "share") {
      // center (slightly lower like sample)
      const x = Math.round(size / 2 - logoSize / 2);
      const y = Math.round(size * 0.62 - logoSize / 2);
      octx.drawImage(logo, x, y, logoSize, logoSize);
    }
  }

  return out;
}

// ---- interactions ----
function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

canvas.addEventListener("pointerdown", (e) => {
  if (!userImg) return;
  canvas.setPointerCapture(e.pointerId);
  isDragging = true;
  const p = pointerPos(e);
  lastX = p.x;
  lastY = p.y;
});

canvas.addEventListener("pointermove", (e) => {
  if (!isDragging || !userImg) return;
  const p = pointerPos(e);

  const dx = p.x - lastX;
  const dy = p.y - lastY;

  lastX = p.x;
  lastY = p.y;

  offsetX += dx;
  offsetY += dy;

  scheduleDraw();
});

canvas.addEventListener("pointerup", () => (isDragging = false));
canvas.addEventListener("pointercancel", () => (isDragging = false));

zoomEl.addEventListener("input", () => {
  zoom = parseFloat(zoomEl.value);
  zoomText.textContent = `${zoom.toFixed(2)}x`;
  scheduleDraw();
});

btnFit.addEventListener("click", () => {
  fitToHole();
  showToast("মাঝখানে সেট করা হয়েছে");
});

qualityEl.addEventListener("change", () => {
  qText.textContent = String(qualityEl.value);
  showToast(`এক্সপোর্ট: ${qualityEl.value}px`);
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  // cleanup old blob
  if (userImgURL) URL.revokeObjectURL(userImgURL);
  userImgURL = URL.createObjectURL(file);

  const im = new Image();
  im.decoding = "async";
  im.onload = () => {
    userImg = im;
    fitToHole();
    scheduleDraw();
    showToast("ছবি লোড হয়েছে");
  };
  im.onerror = () => showToast("ছবি লোড হয়নি");
  im.src = userImgURL;
});

// ---- frame upload ----
frameUpload.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    const url = await dataURLFromFile(file);
    const im = await imageFromURL(url);

    // make a thumb
    const t = document.createElement("canvas");
    t.width = 160; t.height = 160;
    const tctx = t.getContext("2d");
    tctx.drawImage(im, 0, 0, 160, 160);
    const thumb = t.toDataURL("image/png");

    const id = "u" + Date.now();
    const item = { id, name: "Custom", src: url, thumb };

    const customs = loadCustomFrames();
    customs.unshift(item);
    saveCustomFrames(customs);

    frames = [...builtInFrames, ...loadCustomFrames()];
    selectedFrameId = id;
    renderFrameList();
    await loadFrame(url);

    showToast("নতুন ফ্রেম যোগ হয়েছে");
  } catch {
    showToast("ফ্রেম যোগ করা যায়নি");
  } finally {
    frameUpload.value = "";
  }
});

// ---- download/share ----
btnDownload.addEventListener("click", async () => {
  if (!userImg) return showToast("আগে ছবি আপলোড করুন");
  const out = drawExport("download");
  out.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = "dp.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("ডাউনলোড শুরু হয়েছে");
  }, "image/png");
});

btnShare.addEventListener("click", async () => {
  if (!userImg) return showToast("আগে ছবি আপলোড করুন");

  const out = drawExport("share");
  const blob = await new Promise((res) => out.toBlob(res, "image/png"));
  if (!blob) return showToast("শেয়ার করা যায়নি");

  const file = new File([blob], "dp.png", { type: "image/png" });

  // Web Share API
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "DP Maker", text: "No Boat No Vote" });
      showToast("শেয়ার করা হয়েছে");
      return;
    } catch {
      // fall through to download
    }
  }

  // fallback
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = "dp.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast("শেয়ার সাপোর্ট নেই — ডাউনলোড করা হয়েছে");
});

// ---- load initial frame ----
async function loadFrame(src) {
  return new Promise((resolve) => {
    frameImg.onload = () => {
      buildHoleMaskAndBBox();
      fitToHole();
      scheduleDraw();
      resolve();
    };
    frameImg.onerror = () => {
      showToast("ফ্রেম লোড হয়নি");
      resolve();
    };
    frameImg.src = src;
  });
}

// ---- PWA: service worker & install prompt ----
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = "inline-block";
});

installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.style.display = "none";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// init
(function init() {
  qText.textContent = String(qualityEl.value || "1080");
  zoomText.textContent = `${zoom.toFixed(2)}x`;
  renderFrameList();
  const initial = frames.find((f) => f.id === selectedFrameId) || frames[0];
  if (initial) loadFrame(initial.src);
  draw();
})();
