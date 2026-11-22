// Global variables & state
let isModelLoaded = false;
let registeredLabeledDescriptors = [];
let faceMatcher = null;
let currentCameraStream = null;
let currentFacingMode = 'user'; // 'user' (front) or 'environment' (back)
let capturedRegistrationDescriptor = null;
let isContinuousScanning = false;
let isProcessingAttendance = false;
let deferredPrompt = null;

// Dynamic Backend URL (supports both same-origin local & GitHub Pages pointing to remote server)
function getApiBaseUrl() {
  const savedUrl = localStorage.getItem('custom_backend_url');
  if (savedUrl && savedUrl.trim() !== '') {
    return savedUrl.trim().replace(/\/+$/, '');
  }
  // Default: if running on github.io or file:, use blank or prompt
  if (window.location.hostname.includes('github.io')) {
    return 'http://localhost:4000'; // Default fallback, customizable via Settings gear
  }
  return '';
}

// DOM Elements
const videoStream = document.getElementById('video-stream');
const overlayCanvas = document.getElementById('overlay-canvas');
const regVideo = document.getElementById('reg-video');
const modelLoader = document.getElementById('model-loader');
const loaderStatus = document.getElementById('loader-status');
const scannerStatusText = document.getElementById('scanner-status-text');
const checkinBlank = document.getElementById('checkin-blank');
const checkinResult = document.getElementById('checkin-result');
const facesCountSpan = document.getElementById('faces-count');
const scannerLaser = document.getElementById('scanner-laser');

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('PWA Service Worker registered'))
      .catch(err => console.log('Service Worker error:', err));
  }

  // Handle PWA Install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('btn-install-app');
    if (installBtn) installBtn.classList.remove('hidden');
  });

  await loadAIModels();
  await reloadRegisteredFaces();
  await checkWhatsAppStatus();
  startScannerCamera();

  // Hide animated scanner laser until scanning is triggered
  if (scannerLaser) scannerLaser.style.display = 'none';

  // Listen for Enter key anywhere on the page
  window.addEventListener('keydown', (e) => {
    const isScannerActive = !document.getElementById('tab-scan').classList.contains('hidden');
    const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    if (e.key === 'Enter' && isScannerActive && !isTyping) {
      e.preventDefault();
      triggerManualScan();
    }
  });
});

// Install PWA Trigger
function promptInstallPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('User installed the Attendance App');
        document.getElementById('btn-install-app').classList.add('hidden');
      }
      deferredPrompt = null;
    });
  }
}

// Server Config Modal Functions
function openServerConfigModal() {
  document.getElementById('config-backend-url').value = localStorage.getItem('custom_backend_url') || '';
  document.getElementById('server-config-modal').classList.remove('hidden');
}

function closeServerConfigModal() {
  document.getElementById('server-config-modal').classList.add('hidden');
}

function saveServerConfig() {
  const url = document.getElementById('config-backend-url').value.trim();
  if (url) {
    localStorage.setItem('custom_backend_url', url);
  } else {
    localStorage.removeItem('custom_backend_url');
  }
  closeServerConfigModal();
  reloadRegisteredFaces();
  checkWhatsAppStatus();
}

function resetServerConfig() {
  localStorage.removeItem('custom_backend_url');
  document.getElementById('config-backend-url').value = '';
  closeServerConfigModal();
  reloadRegisteredFaces();
  checkWhatsAppStatus();
}

// Switch Tabs
function switchTab(tabId) {
  ['scan', 'register', 'logs'].forEach(tab => {
    document.getElementById(`tab-${tab}`).classList.add('hidden');
    
    // Update Mobile Nav
    const mobBtn = document.getElementById(`nav-${tab}-btn`);
    if (mobBtn) {
      mobBtn.className = "py-2 rounded-2xl flex flex-col items-center justify-center text-slate-400 transition";
    }

    // Update Desktop Nav
    const webBtn = document.getElementById(`web-nav-${tab}-btn`);
    if (webBtn) {
      webBtn.className = "px-5 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white transition";
    }
  });

  document.getElementById(`tab-${tabId}`).classList.remove('hidden');

  const activeMobBtn = document.getElementById(`nav-${tabId}-btn`);
  if (activeMobBtn) {
    activeMobBtn.className = "py-2 rounded-2xl flex flex-col items-center justify-center text-emerald-400 font-bold transition";
  }

  const activeWebBtn = document.getElementById(`web-nav-${tabId}-btn`);
  if (activeWebBtn) {
    activeWebBtn.className = "px-5 py-2 rounded-xl text-xs font-bold transition bg-emerald-600 text-white shadow-md shadow-emerald-600/30";
  }

  if (tabId === 'register') {
    startRegisterCamera();
  } else if (tabId === 'scan') {
    startScannerCamera();
  } else if (tabId === 'logs') {
    loadAttendanceLogs();
  }
}

// 1. Load Face-API Neural Models
async function loadAIModels() {
  try {
    loaderStatus.innerText = "Loading TinyFaceDetector model...";
    await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
    loaderStatus.innerText = "Loading FaceLandmark model...";
    await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
    loaderStatus.innerText = "Loading FaceRecognition neural net...";
    await faceapi.nets.faceRecognitionNet.loadFromUri('/models');

    isModelLoaded = true;
    modelLoader.classList.add('hidden');
    console.log("Face recognition models loaded successfully.");
  } catch (error) {
    console.error("Error loading face models:", error);
    loaderStatus.innerHTML = `<span class="text-rose-400">Error loading models: ${error.message}</span>`;
  }
}

// 2. Load Registered Students & Build Face Matcher
async function reloadRegisteredFaces() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/students/descriptors`);
    const students = await res.json();
    facesCountSpan.innerText = students.length;

    if (students.length > 0) {
      const labeledDescriptors = students.map(st => {
        // Float32Array required by face-api
        const descriptorArray = new Float32Array(st.face_descriptor);
        // Label format: studentId::name::roll::batch::parentPhone
        const label = `${st.id}::${st.name}::${st.roll_no}::${st.batch || ''}::${st.parent_phone}`;
        return new faceapi.LabeledFaceDescriptors(label, [descriptorArray]);
      });

      // Distance threshold: 0.55 (lower = stricter match)
      faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.55);
      console.log(`Face Matcher initialized with ${students.length} students.`);
    } else {
      faceMatcher = null;
      console.log("No registered students found yet.");
    }
  } catch (err) {
    console.error("Error fetching student descriptors:", err);
  }
}

// 3. Start Camera for Scanner (with dynamic Front/Back facingMode)
async function startScannerCamera() {
  if (currentCameraStream) {
    currentCameraStream.getTracks().forEach(track => track.stop());
  }

  try {
    const constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: { ideal: currentFacingMode }
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentCameraStream = stream;
    videoStream.srcObject = stream;

    // Only mirror video if front-facing
    videoStream.style.transform = (currentFacingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';

    videoStream.onloadedmetadata = () => {
      videoStream.play();
      startFaceDetectionLoop();
    };
  } catch (err) {
    console.error("Camera access error:", err);
    scannerStatusText.innerText = "Camera permission denied or camera not found.";
  }
}

// Flip Camera between Hardware Front (Selfie) and Back (Environment) Cameras
async function toggleCameraMirror() {
  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  scannerStatusText.innerText = `Switched to ${currentFacingMode === 'user' ? 'Front' : 'Back'} Camera...`;
  await startScannerCamera();
}

// 4. Manual Scan on ENTER Key or Button
async function triggerManualScan() {
  if (!isModelLoaded) {
    alert("AI Models are still loading. Please wait a second.");
    return;
  }
  if (videoStream.paused || videoStream.ended) {
    alert("Camera is not active.");
    return;
  }
  if (isProcessingAttendance) return;

  const btn = document.getElementById('btn-manual-scan');
  const counter = document.getElementById('detected-counter');
  
  if (scannerLaser) scannerLaser.style.display = 'block';
  if (counter) counter.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-ping';
  scannerStatusText.innerText = "Analyzing face...";
  if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Scanning...`;

  const displaySize = { width: videoStream.videoWidth || 640, height: videoStream.videoHeight || 480 };
  faceapi.matchDimensions(overlayCanvas, displaySize);
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  try {
    const detections = await faceapi.detectAllFaces(
      videoStream, 
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
    )
    .withFaceLandmarks()
    .withFaceDescriptors();

    const resizedDetections = faceapi.resizeResults(detections, displaySize);

    if (resizedDetections.length === 0) {
      scannerStatusText.innerText = "No face detected! Look directly into the camera and press Enter.";
      if (counter) counter.className = 'w-2 h-2 rounded-full bg-rose-500';
    } else {
      if (!faceMatcher) {
        scannerStatusText.innerText = "No students registered yet! Go to the Register tab first.";
        if (counter) counter.className = 'w-2 h-2 rounded-full bg-amber-500';
        return;
      }

      let matchFound = false;
      for (const detection of resizedDetections) {
        const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
        const box = detection.detection.box;

        if (bestMatch.label !== 'unknown') {
          matchFound = true;
          const [studentId, name, roll, batch, parentPhone] = bestMatch.label.split('::');

          const drawBox = new faceapi.draw.DrawBox(box, {
            label: `${name} (${(1 - bestMatch.distance).toFixed(2) * 100}%)`,
            boxColor: '#22c55e'
          });
          drawBox.draw(overlayCanvas);

          scannerStatusText.innerText = `Recognized: ${name}! Recording attendance...`;
          if (counter) counter.className = 'w-2 h-2 rounded-full bg-emerald-500';
          await handleAttendanceTrigger(studentId, name, roll, batch, parentPhone);
          break;
        } else {
          const drawBox = new faceapi.draw.DrawBox(box, {
            label: 'Unregistered Student',
            boxColor: '#f43f5e'
          });
          drawBox.draw(overlayCanvas);
        }
      }

      if (!matchFound) {
        scannerStatusText.innerText = "Face not recognized. Student not found in registration database.";
        if (counter) counter.className = 'w-2 h-2 rounded-full bg-rose-500';
      }
    }
  } catch (err) {
    console.error("Manual scan error:", err);
    scannerStatusText.innerText = "Scan error: " + err.message;
  } finally {
    setTimeout(() => {
      if (scannerLaser && !isContinuousScanning) scannerLaser.style.display = 'none';
      if (btn) btn.innerHTML = `<i class="fa-solid fa-expand mr-1.5 text-sm"></i> Scan Face (Press Enter)`;
      if (counter && !isContinuousScanning) counter.className = 'w-2 h-2 rounded-full bg-slate-500';
    }, 1200);
  }
}

// Toggle continuous auto-scanning (optional)
function toggleContinuousScan() {
  isContinuousScanning = !isContinuousScanning;
  const statusEl = document.getElementById('auto-scan-status');
  const btn = document.getElementById('btn-toggle-continuous');

  if (isContinuousScanning) {
    statusEl.innerText = "ON";
    statusEl.className = "text-emerald-400 font-bold";
    if (scannerLaser) scannerLaser.style.display = 'block';
    startContinuousLoop();
  } else {
    statusEl.innerText = "OFF";
    statusEl.className = "text-rose-400 font-bold";
    if (scannerLaser) scannerLaser.style.display = 'none';
    if (detectionInterval) clearInterval(detectionInterval);
  }
}

let detectionInterval = null;
function startContinuousLoop() {
  if (detectionInterval) clearInterval(detectionInterval);
  detectionInterval = setInterval(() => {
    if (isContinuousScanning && !isProcessingAttendance) {
      triggerManualScan();
    }
  }, 1000);
}

// Stub old function
function startFaceDetectionLoop() {
  // Manual trigger mode by default
}

let pendingLeaveStudent = null;

// 5. Handle Attendance Verification Flow (Entry vs Leaving Popup)
async function handleAttendanceTrigger(studentId, name, roll, batch, parentPhone) {
  isProcessingAttendance = true;

  try {
    // First, check student status: are they entering or leaving?
    const checkRes = await fetch(`${getApiBaseUrl()}/api/attendance/check-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId })
    });

    const statusData = await checkRes.json();

    if (statusData.isInside) {
      // Student is already inside! Show popup: "is student leaving?"
      pendingLeaveStudent = { studentId, name, roll, batch, parentPhone };
      showLeaveConfirmationPopup(name);
      return;
    }

    // Student is not inside -> Mark ENTRY directly
    await executeAttendanceMark(studentId, 'ENTRY');

  } catch (err) {
    console.error("Attendance submission error:", err);
    isProcessingAttendance = false;
  }
}

// Show Leave Confirmation Modal
function showLeaveConfirmationPopup(studentName) {
  document.getElementById('leave-student-name').innerText = studentName;
  document.getElementById('leave-confirm-modal').classList.remove('hidden');
}

// Cancel Leave Confirmation
function cancelStudentLeave() {
  document.getElementById('leave-confirm-modal').classList.add('hidden');
  pendingLeaveStudent = null;
  setTimeout(() => {
    isProcessingAttendance = false;
  }, 1000);
}

// Confirm Leave Action
async function confirmStudentLeave() {
  document.getElementById('leave-confirm-modal').classList.add('hidden');
  if (pendingLeaveStudent) {
    const student = pendingLeaveStudent;
    pendingLeaveStudent = null;
    await executeAttendanceMark(student.studentId, 'EXIT');
  } else {
    isProcessingAttendance = false;
  }
}

// Execute Attendance API call (ENTRY or EXIT)
async function executeAttendanceMark(studentId, actionType) {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/attendance/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId, action_type: actionType })
    });

    const data = await res.json();
    if (data.success) {
      showCheckinSuccess(data);
    }
  } catch (err) {
    console.error("Error submitting attendance:", err);
  } finally {
    setTimeout(() => {
      isProcessingAttendance = false;
    }, 4000);
  }
}

// Show Confirmation Card
function showCheckinSuccess(data) {
  checkinBlank.classList.add('hidden');
  checkinResult.classList.remove('hidden');

  const isExit = data.type === 'EXIT';

  document.getElementById('res-student-name').innerText = data.student.name;
  document.getElementById('res-roll-batch').innerText = `${data.student.batch || 'General Batch'} • ${isExit ? 'LEFT' : 'ENTERED'}`;
  document.getElementById('res-checkin-time').innerText = `${data.time || new Date().toLocaleTimeString()}`;
  document.getElementById('res-parent-phone').innerText = data.student.parent_phone;

  const waBadge = document.getElementById('res-wa-badge');

  if (data.cooldown) {
    waBadge.innerText = "ALREADY RECORDED";
    waBadge.className = "px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wide uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30";
  } else {
    waBadge.innerText = isExit ? "EXIT DISPATCHED" : "ENTRY DISPATCHED";
    waBadge.className = isExit 
      ? "px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wide uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30"
      : "px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wide uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
  }

  // Audio chime feedback
  playSuccessSound();
}

function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.1); // A5
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}

// 6. Camera for Student Registration
async function startRegisterCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 480, height: 480, facingMode: { ideal: currentFacingMode } },
      audio: false
    });
    regVideo.srcObject = stream;
    regVideo.style.transform = (currentFacingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
    regVideo.play();
  } catch (err) {
    console.error("Registration camera error:", err);
  }
}

// Capture face descriptor for Registration
async function captureFaceForRegistration() {
  const indicator = document.getElementById('face-captured-indicator');
  indicator.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Extracting facial features...`;

  try {
    const detection = await faceapi.detectSingleFace(
      regVideo,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
    )
    .withFaceLandmarks()
    .withFaceDescriptor();

    if (!detection) {
      indicator.innerHTML = `<span class="text-rose-400"><i class="fa-solid fa-xmark mr-1"></i> No face detected. Look directly at camera!</span>`;
      capturedRegistrationDescriptor = null;
      return;
    }

    // Convert Float32Array to standard array for JSON storage
    capturedRegistrationDescriptor = Array.from(detection.descriptor);
    indicator.innerHTML = `<span class="text-emerald-400"><i class="fa-solid fa-check mr-1"></i> Face captured successfully! (128 vectors)</span>`;
  } catch (err) {
    indicator.innerHTML = `<span class="text-rose-400">Capture failed: ${err.message}</span>`;
  }
}

// Handle Student Registration Form Submission
async function handleRegistration(e) {
  e.preventDefault();

  if (!capturedRegistrationDescriptor) {
    alert("Please capture the student's face before submitting!");
    return;
  }

  const payload = {
    name: document.getElementById('reg-name').value,
    roll_no: document.getElementById('reg-roll').value,
    batch: document.getElementById('reg-batch').value,
    parent_name: document.getElementById('reg-parent-name').value,
    parent_phone: document.getElementById('reg-parent-phone').value,
    face_descriptor: capturedRegistrationDescriptor
  };

  const submitBtn = document.getElementById('btn-submit-reg');
  submitBtn.disabled = true;
  submitBtn.innerText = "Registering...";

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/students/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");

    alert(`Student "${payload.name}" registered successfully!`);
    document.getElementById('register-form').reset();
    capturedRegistrationDescriptor = null;
    document.getElementById('face-captured-indicator').innerHTML = `<span class="text-amber-400"><i class="fa-solid fa-triangle-exclamation mr-1"></i> No face captured yet</span>`;

    // Refresh facial descriptors in matcher
    await reloadRegisteredFaces();
    // Switch to scanner
    switchTab('scan');
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = "Complete Student Registration";
  }
}

// 7. Load Attendance Logs
async function loadAttendanceLogs() {
  const container = document.getElementById('logs-list-container');
  if (!container) return;
  container.innerHTML = `<div class="text-center py-6 text-xs text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Loading...</div>`;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/attendance/logs`);
    const logs = await res.json();

    if (logs.length === 0) {
      container.innerHTML = `<div class="text-center py-8 text-xs text-slate-500">No attendance recorded today yet.</div>`;
      return;
    }

    container.innerHTML = logs.map(row => {
      const isSuccess = row.whatsapp_status === 'SENT' || row.whatsapp_status === 'SIMULATED';
      const badgeStyle = isSuccess 
        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20';

      const timeStr = new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

      return `
        <div class="p-3 rounded-2xl bg-slate-900/80 border border-slate-800/80 flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">
              ${row.student_name.charAt(0)}
            </div>
            <div>
              <h4 class="text-xs font-bold text-white leading-tight">${row.student_name}</h4>
              <p class="text-[10px] text-slate-400 font-mono mt-0.5">Roll: ${row.roll_no} • ${row.parent_phone}</p>
            </div>
          </div>
          <div class="text-right flex flex-col items-end">
            <span class="text-[10px] font-mono text-slate-300">${timeStr}</span>
            <span class="mt-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold tracking-wide uppercase ${badgeStyle}">
              ${row.whatsapp_status}
            </span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-center py-6 text-xs text-rose-400">Failed to load attendance logs.</div>`;
  }
}

// 8. Check WhatsApp Service Status
let qrPollingInterval = null;

async function checkWhatsAppStatus() {
  const textEl = document.getElementById('wa-status-text');
  const pill = document.getElementById('wa-pill');

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/whatsapp/status`);
    const data = await res.json();

    if (data.config.simulate) {
      if (textEl) textEl.innerText = "Simulated";
      if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1.5 mt-0.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400";
    } else if (data.service && (data.service.status === 'authenticated' || data.service.status === 'ready' || data.service.status === 'CONNECTED')) {
      if (textEl) textEl.innerText = (data.service.pushName || 'WhatsApp Active');
      if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1.5 mt-0.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400";
      closeQRCodeModal();
    } else if (data.service && data.service.status === 'qr_ready') {
      if (textEl) textEl.innerText = "Scan WhatsApp QR";
      if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1.5 mt-0.5 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 animate-pulse";
    } else {
      if (textEl) textEl.innerText = "WhatsApp Offline";
      if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1.5 mt-0.5 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400";
    }
  } catch (err) {
    if (textEl) textEl.innerText = "Server Disconnected";
    if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1.5 mt-0.5 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400";
  }
}

function handleWhatsAppPillClick() {
  showQRCodeModal();
}

async function showQRCodeModal() {
  document.getElementById('qr-modal').classList.remove('hidden');
  await fetchAndDisplayQR();
  if (qrPollingInterval) clearInterval(qrPollingInterval);
  qrPollingInterval = setInterval(fetchAndDisplayQR, 4000);
}

function closeQRCodeModal() {
  document.getElementById('qr-modal').classList.add('hidden');
  if (qrPollingInterval) clearInterval(qrPollingInterval);
}

async function fetchAndDisplayQR() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/whatsapp/qr`);
    const data = await res.json();
    if (data && data.qrCode) {
      document.getElementById('qr-image').src = data.qrCode;
    }
    // Also check status in parallel
    checkWhatsAppStatus();
  } catch (err) {
    console.error("Failed to fetch QR code:", err);
  }
}
