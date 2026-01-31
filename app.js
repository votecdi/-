const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const fileInput = document.getElementById("file");
const zoomEl = document.getElementById("zoom");
const zoomText = document.getElementById("zoomText");
const btnDownload = document.getElementById("download");
const btnReset = document.getElementById("reset");
const btnFit = document.getElementById("fit");

const FRAME_SRC = "frame.png";

let userImg = null;
let frameImg = new Image();
let zoom = 1;
let offsetX = 0;
let offsetY = 0;

let dragging = false;
let lastX = 0;
let lastY = 0;

frameImg.src = FRAME_SRC;
frameImg.onload = () => draw();
frameImg.onerror = () => alert("frame.png পাওয়া যায়নি। একই ফোল্ডারে frame.png আছে কিনা চেক করুন।");

function clear(){ ctx.clearRect(0,0,canvas.width,canvas.height); }
function bg(){ ctx.fillStyle="#000"; ctx.fillRect(0,0,canvas.width,canvas.height); }

function drawUser(){
  if(!userImg) return;
  const cw=canvas.width, ch=canvas.height;
  const iw=userImg.width, ih=userImg.height;

  const cover = Math.max(cw/iw, ch/ih);
  const scale = cover * zoom;

  const w = iw*scale, h = ih*scale;
  const x = (cw-w)/2 + offsetX;
  const y = (ch-h)/2 + offsetY;

  ctx.drawImage(userImg, x, y, w, h);
}

function drawFrame(){
  if(!frameImg.complete) return;
  ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
}

function draw(){
  clear();
  bg();
  drawUser();
  drawFrame();
}

function resetAll(){
  zoom=1; offsetX=0; offsetY=0;
  zoomEl.value=String(zoom);
  zoomText.textContent=`${zoom.toFixed(2)}x`;
  draw();
}

function centerOnly(){ offsetX=0; offsetY=0; draw(); }

zoomEl.addEventListener("input", ()=>{
  zoom = Number(zoomEl.value);
  zoomText.textContent = `${zoom.toFixed(2)}x`;
  draw();
});

fileInput.addEventListener("change", (e)=>{
  const f = e.target.files?.[0];
  if(!f) return;
  const img = new Image();
  img.onload = ()=>{ userImg = img; resetAll(); };
  img.src = URL.createObjectURL(f);
});

btnReset.addEventListener("click", resetAll);
btnFit.addEventListener("click", centerOnly);

btnDownload.addEventListener("click", ()=>{
  if(!userImg){ alert("আগে একটি ছবি আপলোড করুন।"); return; }
  draw();
  const a=document.createElement("a");
  a.download="dp-frame.png";
  a.href=canvas.toDataURL("image/png");
  a.click();
});

function point(ev){
  const r=canvas.getBoundingClientRect();
  let cx, cy;
  if(ev.touches && ev.touches[0]){ cx=ev.touches[0].clientX; cy=ev.touches[0].clientY; }
  else { cx=ev.clientX; cy=ev.clientY; }
  return { x:(cx-r.left)*(canvas.width/r.width), y:(cy-r.top)*(canvas.height/r.height) };
}

function down(ev){
  if(!userImg) return;
  dragging=true;
  const p=point(ev);
  lastX=p.x; lastY=p.y;
}
function move(ev){
  if(!dragging) return;
  ev.preventDefault();
  const p=point(ev);
  offsetX += (p.x-lastX);
  offsetY += (p.y-lastY);
  lastX=p.x; lastY=p.y;
  draw();
}
function up(){ dragging=false; }

canvas.addEventListener("mousedown", down);
window.addEventListener("mousemove", move);
window.addEventListener("mouseup", up);
canvas.addEventListener("touchstart", down, {passive:false});
canvas.addEventListener("touchmove", move, {passive:false});
canvas.addEventListener("touchend", up);
canvas.style.touchAction = "none";
