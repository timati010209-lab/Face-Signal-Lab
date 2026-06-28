const video = document.querySelector("#cameraFeed");
const overlayCanvas = document.querySelector("#overlayCanvas");
const stage = document.querySelector("#stage");
const cameraButton = document.querySelector("#cameraButton");
const mirrorButton = document.querySelector("#mirrorButton");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const fpsText = document.querySelector("#fpsText");
const faceStatus = document.querySelector("#faceStatus");
const poseStatus = document.querySelector("#poseStatus");
const tiltStatus = document.querySelector("#tiltStatus");
const lightStatus = document.querySelector("#lightStatus");
const expressionStatus = document.querySelector("#expressionStatus");
const ageInput = document.querySelector("#ageInput");
const genderInput = document.querySelector("#genderInput");
const moodInput = document.querySelector("#moodInput");
const profileSummary = document.querySelector("#profileSummary");

const overlayCtx = overlayCanvas.getContext("2d", { willReadFrequently: false });
const analysisCanvas = document.createElement("canvas");
const analysisCtx = analysisCanvas.getContext("2d", {
  alpha: false,
  desynchronized: true,
  willReadFrequently: true,
});

const TARGET_FPS = 45;
const ANALYSIS_WIDTH = 384;
const OBS_MODE = new URLSearchParams(window.location.search).get("obs") === "1";

const state = {
  running: false,
  mirrored: true,
  faceMesh: null,
  rafId: 0,
  processingFrame: false,
  lastProcessAt: 0,
  processInterval: 1000 / TARGET_FPS,
  canvasScale: 1,
  frameCount: 0,
  fpsStartedAt: performance.now(),
};

function boot() {
  applyObsModeLayout();

  if (window.lucide) {
    window.lucide.createIcons();
  }

  resizeCanvas();
  video.classList.toggle("is-mirrored", state.mirrored);
  window.addEventListener("resize", resizeCanvas);
  cameraButton.addEventListener("click", toggleCamera);
  mirrorButton.addEventListener("click", toggleMirror);
  [ageInput, genderInput, moodInput].forEach((input) => {
    input.addEventListener("change", updateProfileSummary);
  });
  updateProfileSummary();

  if (OBS_MODE) {
    window.setTimeout(() => {
      if (!state.running) {
        toggleCamera();
      }
    }, 400);
  }
}

function applyObsModeLayout() {
  document.body.classList.toggle("obs-mode", OBS_MODE);
  if (!OBS_MODE) return;

  document.querySelectorAll(".topbar, .metrics-panel, .live-badge").forEach((element) => {
    element.hidden = true;
  });
  document.querySelector(".face-app").style.display = "block";
  document.querySelector(".camera-panel").style.height = "100vh";
  stage.style.height = "100vh";
}

async function toggleCamera() {
  if (state.running) {
    stopCamera();
    return;
  }

  try {
    setStatus("loading model", false);
    await ensureFaceMesh();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640, max: 640 },
        height: { ideal: 480, max: 480 },
        frameRate: { ideal: 60, max: 60 },
        facingMode: "user",
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
    configureAnalysisCanvas();
    state.running = true;
    cameraButton.classList.remove("primary");
    cameraButton.innerHTML = '<i data-lucide="square"></i><span>Stop camera</span>';
    if (window.lucide) window.lucide.createIcons();
    setStatus("camera live", true);
    analyzeLoop();
  } catch (error) {
    setStatus("camera blocked", false);
    faceStatus.textContent = error.message;
  }
}

function stopCamera() {
  cancelAnimationFrame(state.rafId);
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  video.srcObject = null;
  state.running = false;
  state.processingFrame = false;
  clearOverlay();
  setStatus("camera idle", false);
  cameraButton.classList.add("primary");
  cameraButton.innerHTML = '<i data-lucide="video"></i><span>Start camera</span>';
  if (window.lucide) window.lucide.createIcons();
  faceStatus.textContent = "not detected";
  poseStatus.textContent = "--";
  tiltStatus.textContent = "--";
  lightStatus.textContent = "--";
  expressionStatus.textContent = "--";
}

async function ensureFaceMesh() {
  if (state.faceMesh) return;
  if (!window.FaceMesh) {
    throw new Error("MediaPipe Face Mesh did not load");
  }

  state.faceMesh = new window.FaceMesh({
    locateFile: (file) => `./assets/libs/mediapipe/face_mesh/${file}`,
  });
  state.faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
  state.faceMesh.onResults(onFaceResults);
}

function analyzeLoop(now = performance.now()) {
  if (!state.running) return;

  const canProcess =
    video.readyState >= 2 &&
    !state.processingFrame &&
    now - state.lastProcessAt >= state.processInterval;

  if (canProcess) {
    state.processingFrame = true;
    state.lastProcessAt = now;
    drawAnalysisFrame();
    state.faceMesh
      .send({ image: analysisCanvas })
      .then(updateFps)
      .catch((error) => {
        faceStatus.textContent = error.message;
      })
      .finally(() => {
        state.processingFrame = false;
      });
  }

  state.rafId = requestAnimationFrame(analyzeLoop);
}

function onFaceResults(results) {
  clearOverlay();
  const face = results.multiFaceLandmarks && results.multiFaceLandmarks[0];

  if (!face) {
    setStatus("searching face", state.running);
    faceStatus.textContent = "not detected";
    poseStatus.textContent = "--";
    tiltStatus.textContent = "--";
    expressionStatus.textContent = "--";
    return;
  }

  setStatus("tracking face", true);
  const points = face.map(landmarkToStagePoint);
  const bounds = getBounds(points);
  const metrics = getFaceMetrics(points, bounds);
  const lighting = getLighting();

  drawFaceOverlay(points, bounds, metrics);
  faceStatus.textContent = "detected";
  poseStatus.textContent = metrics.pose;
  tiltStatus.textContent = `${metrics.tiltLabel} (${metrics.tiltDegrees} deg)`;
  lightStatus.textContent = lighting;
  expressionStatus.textContent = metrics.expressionCue;
}

function getFaceMetrics(points, bounds) {
  const leftEye = midpoint(points[33], points[133]);
  const rightEye = midpoint(points[362], points[263]);
  const nose = points[1];
  const leftMouth = points[61];
  const rightMouth = points[291];
  const upperLip = points[13];
  const lowerLip = points[14];

  const eyeCenter = midpoint(leftEye, rightEye);
  const eyeSpan = distance(leftEye, rightEye) || 1;
  const yaw = (nose.x - eyeCenter.x) / eyeSpan;
  const tiltRadians = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const tiltDegrees = Math.round((tiltRadians * 180) / Math.PI);
  const mouthWidth = distance(leftMouth, rightMouth) || 1;
  const mouthOpen = distance(upperLip, lowerLip) / mouthWidth;
  const smileWidth = mouthWidth / (bounds.width || 1);

  let pose = "center";
  if (yaw > 0.12) pose = state.mirrored ? "turned left" : "turned right";
  if (yaw < -0.12) pose = state.mirrored ? "turned right" : "turned left";

  let tiltLabel = "level";
  if (tiltDegrees > 6) tiltLabel = "tilted right";
  if (tiltDegrees < -6) tiltLabel = "tilted left";

  let expressionCue = "neutral mouth";
  if (mouthOpen > 0.19) {
    expressionCue = "mouth open";
  } else if (smileWidth > 0.42 && mouthOpen > 0.055) {
    expressionCue = "smile-like cue";
  }

  return {
    pose,
    tiltLabel,
    tiltDegrees,
    expressionCue,
  };
}

function drawFaceOverlay(points, bounds, metrics) {
  overlayCtx.save();
  overlayCtx.strokeStyle = "rgba(73, 242, 167, 0.95)";
  overlayCtx.lineWidth = 2;
  overlayCtx.shadowColor = "rgba(73, 242, 167, 0.7)";
  overlayCtx.shadowBlur = 10;
  overlayCtx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  drawPolyline([10, 338, 297, 332, 284, 251, 389, 356, 454], points, "rgba(71,199,255,0.85)");
  drawPolyline([234, 127, 162, 21, 54, 103, 67, 109, 10], points, "rgba(71,199,255,0.85)");
  drawPolyline([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291], points, "rgba(255,216,90,0.9)");
  drawPolyline([33, 160, 158, 133], points, "rgba(255,255,255,0.76)");
  drawPolyline([362, 385, 387, 263], points, "rgba(255,255,255,0.76)");

  overlayCtx.shadowBlur = 0;
  overlayCtx.fillStyle = "rgba(73, 242, 167, 0.95)";
  [1, 33, 263, 61, 291, 13, 14].forEach((index) => {
    const point = points[index];
    overlayCtx.beginPath();
    overlayCtx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    overlayCtx.fill();
  });

  overlayCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
  overlayCtx.fillRect(bounds.x, Math.max(8, bounds.y - 34), 168, 26);
  overlayCtx.fillStyle = "#eef3f7";
  overlayCtx.font = "12px JetBrains Mono, Consolas, monospace";
  overlayCtx.fillText(`${metrics.pose} / ${metrics.expressionCue}`, bounds.x + 8, Math.max(25, bounds.y - 17));

  const profile = getProfileSummary();
  if (profile !== "Profile: not set") {
    const labelY = Math.min(bounds.y + bounds.height + 32, overlayCanvas.height / state.canvasScale - 20);
    overlayCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
    overlayCtx.fillRect(bounds.x, labelY - 21, Math.min(320, bounds.width + 80), 28);
    overlayCtx.fillStyle = "#dfffee";
    overlayCtx.fillText(profile.replace("Profile: ", "Self: "), bounds.x + 8, labelY - 3);
  }
  overlayCtx.restore();
}

function drawPolyline(indices, points, color) {
  overlayCtx.save();
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = 2;
  overlayCtx.beginPath();
  indices.forEach((index, itemIndex) => {
    const point = points[index];
    if (itemIndex === 0) {
      overlayCtx.moveTo(point.x, point.y);
    } else {
      overlayCtx.lineTo(point.x, point.y);
    }
  });
  overlayCtx.stroke();
  overlayCtx.restore();
}

function getLighting() {
  const width = analysisCanvas.width;
  const height = analysisCanvas.height;
  if (!width || !height) return "--";

  const sample = analysisCtx.getImageData(0, 0, width, height).data;
  let total = 0;
  const step = 24;
  for (let index = 0; index < sample.length; index += step * 4) {
    total += 0.2126 * sample[index] + 0.7152 * sample[index + 1] + 0.0722 * sample[index + 2];
  }
  const average = total / (sample.length / (step * 4));

  if (average < 55) return "low";
  if (average > 178) return "bright";
  return "good";
}

function configureAnalysisCanvas() {
  const videoWidth = video.videoWidth || 640;
  const videoHeight = video.videoHeight || 480;
  const ratio = videoHeight / videoWidth;
  analysisCanvas.width = ANALYSIS_WIDTH;
  analysisCanvas.height = Math.round(ANALYSIS_WIDTH * ratio);
  analysisCtx.imageSmoothingEnabled = false;
}

function drawAnalysisFrame() {
  if (!analysisCanvas.width || !analysisCanvas.height) {
    configureAnalysisCanvas();
  }
  analysisCtx.drawImage(video, 0, 0, analysisCanvas.width, analysisCanvas.height);
}

function landmarkToStagePoint(landmark) {
  const width = overlayCanvas.width / state.canvasScale;
  const height = overlayCanvas.height / state.canvasScale;
  const videoWidth = video.videoWidth || 16;
  const videoHeight = video.videoHeight || 9;
  const videoRatio = videoWidth / videoHeight;
  const stageRatio = width / height;
  let drawnWidth = width;
  let drawnHeight = height;
  let offsetX = 0;
  let offsetY = 0;

  if (stageRatio > videoRatio) {
    drawnHeight = width / videoRatio;
    offsetY = (height - drawnHeight) / 2;
  } else {
    drawnWidth = height * videoRatio;
    offsetX = (width - drawnWidth) / 2;
  }

  const x = state.mirrored ? 1 - landmark.x : landmark.x;
  return {
    x: offsetX + x * drawnWidth,
    y: offsetY + landmark.y * drawnHeight,
  };
}

function getBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 18;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 1.35);
  state.canvasScale = ratio;
  overlayCanvas.width = Math.max(1, Math.round(rect.width * ratio));
  overlayCanvas.height = Math.max(1, Math.round(rect.height * ratio));
  overlayCanvas.style.width = `${rect.width}px`;
  overlayCanvas.style.height = `${rect.height}px`;
  overlayCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function clearOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function toggleMirror() {
  state.mirrored = !state.mirrored;
  video.classList.toggle("is-mirrored", state.mirrored);
  mirrorButton.classList.toggle("is-active", state.mirrored);
}

function updateProfileSummary() {
  profileSummary.textContent = getProfileSummary();
}

function getProfileSummary() {
  const parts = [
    ageInput.value ? `age ${ageInput.value}` : "",
    genderInput.value ? `gender ${genderInput.value}` : "",
    moodInput.value ? `mood ${moodInput.value}` : "",
  ].filter(Boolean);

  return parts.length ? `Profile: ${parts.join(" / ")}` : "Profile: not set";
}

function setStatus(text, live) {
  statusText.textContent = text;
  statusDot.classList.toggle("is-live", live);
}

function updateFps() {
  state.frameCount += 1;
  const now = performance.now();
  const elapsed = now - state.fpsStartedAt;
  if (elapsed >= 1000) {
    fpsText.textContent = `fps ${Math.round((state.frameCount * 1000) / elapsed)}`;
    state.frameCount = 0;
    state.fpsStartedAt = now;
  }
}

boot();
