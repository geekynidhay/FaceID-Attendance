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

// Multi-phone identification & Remote Snap State
let deviceId = localStorage.getItem('apex_device_id');
let deviceName = localStorage.getItem('apex_device_name');
let activeRemoteCapturePolling = null;
let currentIncomingSnapTask = null;
let snapCameraStream = null;

// Cache for all loaded students (for filtering/search and Excel export)
let allStudentsCache = [];
let allBatchesCache = [];

// Initialize Device Identity
function initDeviceIdentity() {
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    localStorage.setItem('apex_device_id', deviceId);
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  if (deviceName && deviceName.trim()) {
    updateDeviceNameDisplay(deviceName.trim());
  } else {
    // If no staff name saved yet, prompt on mobile
    if (isMobile) {
      setTimeout(() => {
        openStaffNameModal();
      }, 500);
    } else {
      deviceName = "Admin PC";
      localStorage.setItem('apex_device_name', deviceName);
      updateDeviceNameDisplay(deviceName);
    }
  }

  // Hide remote staff phone selector on mobile phones
  const remoteToggleGroup = document.getElementById('remote-capture-toggle-group');
  if (remoteToggleGroup && isMobile) {
    remoteToggleGroup.classList.add('hidden');
  }

  // Hide WhatsApp buttons on phone apps (only Institute Web PC needs WhatsApp login/status)
  if (isMobile) {
    const waPill = document.getElementById('wa-pill');
    const waActionBtn = document.getElementById('web-wa-action-btn');
    if (waPill) waPill.classList.add('hidden');
    if (waActionBtn) waActionBtn.classList.add('hidden');
  }

  // Start phone heartbeat
  sendDeviceHeartbeat();
  setInterval(sendDeviceHeartbeat, 15000);

  // If mobile or device name indicates staff phone, listen for incoming photo snap requests
  if (isMobile || (deviceName && deviceName !== 'Admin PC')) {
    startListeningForRemoteSnapRequests();
  }
}

function updateDeviceNameDisplay(name) {
  const nameDisplay = document.getElementById('device-name-display');
  if (nameDisplay) {
    nameDisplay.innerText = name;
  }
}

// Staff Name Modal Controls
function promptChangeStaffName() {
  openStaffNameModal();
}

function openStaffNameModal() {
  const modal = document.getElementById('staff-name-modal');
  const input = document.getElementById('staff-name-input');
  if (modal && input) {
    input.value = deviceName || '';
    modal.classList.remove('hidden');
    input.focus();
  }
}

function closeStaffNameModal() {
  const modal = document.getElementById('staff-name-modal');
  if (modal) modal.classList.add('hidden');
}

function saveStaffName() {
  const input = document.getElementById('staff-name-input');
  const enteredName = input ? input.value.trim() : '';

  if (enteredName) {
    deviceName = enteredName;
    localStorage.setItem('apex_device_name', deviceName);
    updateDeviceNameDisplay(deviceName);
    sendDeviceHeartbeat();
  }
  closeStaffNameModal();
}

async function sendDeviceHeartbeat() {
  try {
    await fetch(`${getApiBaseUrl()}/api/devices/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, device_name: deviceName || 'Staff Device' })
    });
  } catch (e) {}
}

// Dynamic Backend URL
function getApiBaseUrl() {
  const savedUrl = localStorage.getItem('custom_backend_url');
  if (savedUrl && savedUrl.trim() !== '') {
    return savedUrl.trim().replace(/\/+$/, '');
  }
  if (window.location.hostname.includes('github.io')) {
    return 'http://localhost:4000';
  }
  return '';
}

// DOM Elements
const videoStream = document.getElementById('video-stream');
const regVideo = document.getElementById('reg-video');
const modelLoader = document.getElementById('model-loader');
const loaderStatus = document.getElementById('loader-status');
const scannerStatusText = document.getElementById('scanner-status-text');

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
  initDeviceIdentity();

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

  generateAutoRollNumber();
  await loadBatches();
  await loadAIModels();
  await reloadRegisteredFaces();
  await checkWhatsAppStatus();
  startScannerCamera();

  // Listen for Enter key
  window.addEventListener('keydown', (e) => {
    const isScannerActive = !document.getElementById('tab-scan').classList.contains('hidden');
    const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    if (e.key === 'Enter' && isScannerActive && !isTyping) {
      e.preventDefault();
      triggerManualScan();
    }
  });
});

// Toggle 2nd Mobile Number Field
function toggleSecondaryPhoneField() {
  const secContainer = document.getElementById('secondary-phone-container');
  const secInput = document.getElementById('reg-secondary-phone');
  const btnToggle = document.getElementById('btn-toggle-secondary-phone');

  if (secContainer.classList.contains('hidden')) {
    secContainer.classList.remove('hidden');
    btnToggle.classList.add('hidden');
    secInput.focus();
  } else {
    secContainer.classList.add('hidden');
    btnToggle.classList.remove('hidden');
    secInput.value = '';
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
  loadBatches();
}

function resetServerConfig() {
  localStorage.removeItem('custom_backend_url');
  document.getElementById('config-backend-url').value = '';
  closeServerConfigModal();
  reloadRegisteredFaces();
  checkWhatsAppStatus();
  loadBatches();
}

// Auto-generate random unique Roll Number
function generateAutoRollNumber() {
  const rollInput = document.getElementById('reg-roll');
  if (rollInput) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    rollInput.value = `DOT-${randomSuffix}`;
  }
}

// Switch Main Tabs
function switchTab(tabId) {
  ['scan', 'register', 'logs'].forEach(tab => {
    document.getElementById(`tab-${tab}`).classList.add('hidden');
    
    // Mobile Nav
    const mobBtn = document.getElementById(`nav-${tab}-btn`);
    if (mobBtn) {
      mobBtn.className = "py-2 rounded-2xl flex flex-col items-center justify-center text-slate-400 transition";
    }

    // Desktop Nav
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
    generateAutoRollNumber();
    refreshOnlineStaffPhones();
    loadBatches();
  } else if (tabId === 'scan') {
    startScannerCamera();
  } else if (tabId === 'logs') {
    loadAdminStudents();
    loadBatches();
    loadAttendanceLogs();
  }
}

// Admin Sub-Tab Switching (Students vs Batches vs Logs)
function switchAdminSubTab(subTab) {
  const studentsView = document.getElementById('admin-view-students');
  const batchesView = document.getElementById('admin-view-batches');
  const logsView = document.getElementById('admin-view-logs');
  const searchContainer = document.getElementById('admin-search-container');

  const btnStudents = document.getElementById('admin-sub-students');
  const btnBatches = document.getElementById('admin-sub-batches');
  const btnLogs = document.getElementById('admin-sub-logs');

  [btnStudents, btnBatches, btnLogs].forEach(b => {
    if (b) b.className = "px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-white font-semibold transition";
  });

  studentsView.classList.add('hidden');
  batchesView.classList.add('hidden');
  logsView.classList.add('hidden');

  if (subTab === 'students') {
    studentsView.classList.remove('hidden');
    if (searchContainer) searchContainer.classList.remove('hidden');
    btnStudents.className = "px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold transition";
    loadAdminStudents();
  } else if (subTab === 'batches') {
    batchesView.classList.remove('hidden');
    if (searchContainer) searchContainer.classList.add('hidden');
    btnBatches.className = "px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold transition";
    loadBatches();
  } else {
    logsView.classList.remove('hidden');
    if (searchContainer) searchContainer.classList.add('hidden');
    btnLogs.className = "px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold transition";
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

    const adminCount = document.getElementById('admin-students-count');
    if (adminCount) adminCount.innerText = students.length;

    if (students.length > 0) {
      const labeledDescriptors = students.map(st => {
        const descriptorArray = new Float32Array(st.face_descriptor);
        const label = `${st.id}::${st.name}::${st.roll_no}::${st.batch || ''}::${st.parent_phone}::${st.secondary_phone || ''}`;
        return new faceapi.LabeledFaceDescriptors(label, [descriptorArray]);
      });

      faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.55);
      console.log(`Face Matcher initialized with ${students.length} students.`);
    } else {
      faceMatcher = null;
    }
  } catch (err) {
    console.error("Error fetching student descriptors:", err);
  }
}

// 3. Start Camera for Scanner
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
    videoStream.setAttribute('playsinline', '');
    videoStream.setAttribute('muted', '');
    videoStream.muted = true;
    videoStream.style.transform = (currentFacingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';

    videoStream.onloadedmetadata = async () => {
      try {
        await videoStream.play();
      } catch (e) {
        console.warn("videoStream play() failed:", e);
      }
    };
    try {
      await videoStream.play();
    } catch (e) {}
  } catch (err) {
    console.error("Camera access error:", err);
    scannerStatusText.innerText = `Camera error: ${err.name} - ${err.message}`;
  }
}

async function toggleCameraMirror() {
  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  scannerStatusText.innerText = `Switched to ${currentFacingMode === 'user' ? 'Front' : 'Back'} Camera...`;
  await startScannerCamera();
}

// 4. Manual Scan on ENTER Key or Button (Clean View: No Laser, No Boxes)
async function triggerManualScan() {
  if (!isModelLoaded) {
    alert("AI Models are still loading. Please wait a second.");
    return;
  }
  if (!videoStream.srcObject || videoStream.paused || videoStream.ended) {
    alert("Camera is not active.");
    return;
  }
  if (isProcessingAttendance) return;

  const btn = document.getElementById('btn-manual-scan');
  scannerStatusText.innerText = "Analyzing face...";
  if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Scanning...`;

  try {
    const detections = await faceapi.detectAllFaces(
      videoStream, 
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
    )
    .withFaceLandmarks()
    .withFaceDescriptors();

    if (detections.length === 0) {
      scannerStatusText.innerText = "No face detected! Look directly into the camera.";
    } else {
      if (!faceMatcher) {
        scannerStatusText.innerText = "No students registered yet! Go to the Register tab first.";
        return;
      }

      let matchFound = false;
      for (const detection of detections) {
        const bestMatch = faceMatcher.findBestMatch(detection.descriptor);

        if (bestMatch.label !== 'unknown') {
          matchFound = true;
          const [studentId, name, roll, batch, parentPhone] = bestMatch.label.split('::');

          scannerStatusText.innerText = `Recognized: ${name}! Recording attendance...`;
          await handleAttendanceTrigger(studentId, name, roll, batch, parentPhone);
          break;
        }
      }

      if (!matchFound) {
        scannerStatusText.innerText = "Face not recognized. Student not found in registration database.";
      }
    }
  } catch (err) {
    console.error("Manual scan error:", err);
    scannerStatusText.innerText = "Scan error: " + err.message;
  } finally {
    setTimeout(() => {
      if (btn) btn.innerHTML = `<i class="fa-solid fa-expand text-base"></i><span>Scan Face (Enter)</span>`;
    }, 1200);
  }
}

// Toggle continuous auto-scanning
function toggleContinuousScan() {
  isContinuousScanning = !isContinuousScanning;
  const statusEl = document.getElementById('auto-scan-status');

  if (isContinuousScanning) {
    statusEl.innerText = "ON";
    statusEl.className = "text-emerald-400 font-bold";
    startContinuousLoop();
  } else {
    statusEl.innerText = "OFF";
    statusEl.className = "text-rose-400 font-bold";
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
  }, 1200);
}

let pendingLeaveStudent = null;

// 5. Handle Attendance Verification Flow
async function handleAttendanceTrigger(studentId, name, roll, batch, parentPhone) {
  isProcessingAttendance = true;

  try {
    const checkRes = await fetch(`${getApiBaseUrl()}/api/attendance/check-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId })
    });

    const statusData = await checkRes.json();

    if (statusData.isInside) {
      pendingLeaveStudent = { studentId, name, roll, batch, parentPhone };
      showLeaveConfirmationPopup(name);
      return;
    }

    await executeAttendanceMark(studentId, 'ENTRY');

  } catch (err) {
    console.error("Attendance submission error:", err);
    isProcessingAttendance = false;
  }
}

function showLeaveConfirmationPopup(studentName) {
  document.getElementById('leave-student-name').innerText = studentName;
  document.getElementById('leave-confirm-modal').classList.remove('hidden');
}

function cancelStudentLeave() {
  document.getElementById('leave-confirm-modal').classList.add('hidden');
  pendingLeaveStudent = null;
  setTimeout(() => {
    isProcessingAttendance = false;
  }, 1000);
}

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

async function executeAttendanceMark(studentId, actionType) {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/attendance/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId, action_type: actionType })
    });

    const data = await res.json();
    if (data.success) {
      scannerStatusText.innerText = data.type === 'EXIT' 
        ? `Departure recorded for ${data.student.name}!` 
        : `Arrival recorded for ${data.student.name}!`;
      playSuccessSound();
    }
  } catch (err) {
    console.error("Error submitting attendance:", err);
  } finally {
    setTimeout(() => {
      isProcessingAttendance = false;
    }, 3500);
  }
}

function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}

// 6. Camera for Student Registration (Local Mode)
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

function setCaptureMode(mode) {
  const localContainer = document.getElementById('local-capture-container');
  const remoteContainer = document.getElementById('remote-capture-container');
  const btnLocal = document.getElementById('btn-mode-local');
  const btnRemote = document.getElementById('btn-mode-remote');

  if (mode === 'local') {
    localContainer.classList.remove('hidden');
    remoteContainer.classList.add('hidden');
    btnLocal.className = "px-2.5 py-1 rounded-lg font-bold bg-emerald-600 text-white transition";
    btnRemote.className = "px-2.5 py-1 rounded-lg font-semibold text-slate-400 hover:text-white transition";
    startRegisterCamera();
  } else {
    localContainer.classList.add('hidden');
    remoteContainer.classList.remove('hidden');
    btnRemote.className = "px-2.5 py-1 rounded-lg font-bold bg-indigo-600 text-white transition";
    btnLocal.className = "px-2.5 py-1 rounded-lg font-semibold text-slate-400 hover:text-white transition";
    refreshOnlineStaffPhones();
  }
}

async function refreshOnlineStaffPhones() {
  const select = document.getElementById('select-remote-device');
  if (!select) return;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/devices/list`);
    const devices = await res.json();
    const otherDevices = devices.filter(d => d.id !== deviceId);

    if (otherDevices.length === 0) {
      select.innerHTML = `<option value="">No staff phones detected online</option>`;
    } else {
      select.innerHTML = otherDevices.map(d => `
        <option value="${d.id}">${d.name} (${d.id.substring(0, 8)})</option>
      `).join('');
    }
  } catch (err) {
    select.innerHTML = `<option value="">Error detecting staff phones</option>`;
  }
}

// Remote Snap Request
let activeRemoteRequestId = null;
let remoteStatusPollTimer = null;

async function dispatchRemoteCaptureRequest() {
  const studentNameInput = document.getElementById('reg-name');
  const studentName = studentNameInput ? studentNameInput.value.trim() : '';
  if (!studentName) {
    alert("Please enter the student's name first!");
    studentNameInput?.focus();
    return;
  }

  const select = document.getElementById('select-remote-device');
  const targetDeviceId = select?.value;

  if (!targetDeviceId) {
    alert("Please select an online staff phone from the dropdown.");
    return;
  }

  const sendBtn = document.getElementById('btn-send-remote-req');
  const banner = document.getElementById('remote-status-banner');

  sendBtn.disabled = true;
  sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Sending to phone...`;
  banner.classList.remove('hidden');
  banner.innerText = `Request sent to staff phone! Popup triggered. Waiting for photo...`;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/remote-capture/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: targetDeviceId, student_name: studentName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to trigger snap");

    activeRemoteRequestId = data.requestId;

    if (remoteStatusPollTimer) clearInterval(remoteStatusPollTimer);
    remoteStatusPollTimer = setInterval(pollRemoteCaptureStatus, 1500);

  } catch (err) {
    alert("Error: " + err.message);
    sendBtn.disabled = false;
    sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane mr-1.5"></i> Send Snap Request to Phone`;
    banner.classList.add('hidden');
  }
}

async function pollRemoteCaptureStatus() {
  if (!activeRemoteRequestId) return;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/remote-capture/status/${activeRemoteRequestId}`);
    const task = await res.json();

    if (task && (task.status === 'COMPLETED' || task.face_descriptor)) {
      clearInterval(remoteStatusPollTimer);
      remoteStatusPollTimer = null;
      activeRemoteRequestId = null;

      capturedRegistrationDescriptor = task.face_descriptor;

      const banner = document.getElementById('remote-status-banner');
      if (banner) {
        banner.className = "text-xs text-emerald-400 pt-1 font-bold";
        banner.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> Face photo successfully received from staff phone!`;
      }

      const sendBtn = document.getElementById('btn-send-remote-req');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.className = "w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl text-xs transition flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-600/30";
        sendBtn.innerHTML = `<i class="fa-solid fa-check mr-1.5"></i> Photo Received & Synced`;
      }

      const ind = document.getElementById('face-captured-indicator');
      if (ind) {
        ind.innerHTML = `<span class="text-emerald-400"><i class="fa-solid fa-check mr-1"></i> Received from Phone (128 facial vectors)</span>`;
      }
    }
  } catch (e) {}
}

// Phone Receiver for Remote Snap Popup
function startListeningForRemoteSnapRequests() {
  if (activeRemoteCapturePolling) clearInterval(activeRemoteCapturePolling);
  activeRemoteCapturePolling = setInterval(async () => {
    const modal = document.getElementById('incoming-snap-modal');
    if (!modal.classList.contains('hidden')) return;

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/remote-capture/pending/${deviceId}`);
      const task = await res.json();
      if (task && task.requestId) {
        showRemoteSnapModal(task);
      }
    } catch (e) {}
  }, 2000);
}

let snapFacingMode = 'environment'; // default to back camera when taking photo of a student!

async function toggleSnapCameraFacing() {
  snapFacingMode = (snapFacingMode === 'user') ? 'environment' : 'user';
  try {
    if (snapCameraStream) {
      snapCameraStream.getTracks().forEach(t => t.stop());
      snapCameraStream = null;
    }
    const snapVid = document.getElementById('snap-phone-video');
    snapCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: snapFacingMode }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    snapVid.srcObject = snapCameraStream;
    snapVid.setAttribute('playsinline', '');
    snapVid.muted = true;
    snapVid.style.transform = (snapFacingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
    await snapVid.play().catch(e => console.log('play ignored', e));
  } catch (err) {
    console.warn("Error switching camera facing:", err);
  }
}
async function showRemoteSnapModal(task) {
  currentIncomingSnapTask = task;
  const nameEl = document.getElementById('snap-target-name');
  if (nameEl) {
    nameEl.innerText = (task && task.student_name) ? task.student_name : 'Student';
  }
  document.getElementById('incoming-snap-modal').classList.remove('hidden');

  const btn = document.getElementById('btn-snap-submit');
  if (btn) {
    btn.disabled = false;
    btn.innerText = "SNAP & SEND";
  }

  try {
    const snapVid = document.getElementById('snap-phone-video');
    if (snapCameraStream) {
      snapCameraStream.getTracks().forEach(t => t.stop());
      snapCameraStream = null;
    }
    // Stop main camera temporarily so snap camera gets clean hardware access
    if (currentCameraStream) {
      currentCameraStream.getTracks().forEach(t => t.stop());
      currentCameraStream = null;
    }

    snapCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: snapFacingMode }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    snapVid.srcObject = snapCameraStream;
    snapVid.setAttribute('playsinline', '');
    snapVid.muted = true;
    snapVid.style.transform = (snapFacingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
    await snapVid.play().catch(e => console.log('play ignored', e));
  } catch (err) {
    console.warn("Camera setup warning:", err);
  }
}

async function submitRemoteSnap() {
  if (!currentIncomingSnapTask) {
    alert("No active photo request found.");
    dismissRemoteSnap();
    return;
  }

  // Fallback student name string to prevent null error
  const targetStudentName = (currentIncomingSnapTask && currentIncomingSnapTask.student_name) 
    ? currentIncomingSnapTask.student_name 
    : 'Student';

  const btn = document.getElementById('btn-snap-submit');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Extracting...`;

  try {
    const snapVid = document.getElementById('snap-phone-video');
    const detection = await faceapi.detectSingleFace(
      snapVid,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
    )
    .withFaceLandmarks()
    .withFaceDescriptor();

    if (!detection) {
      alert("No face detected! Look directly into the phone camera.");
      btn.disabled = false;
      btn.innerText = "SNAP & SEND";
      return;
    }

    const descriptorArray = Array.from(detection.descriptor);

    await fetch(`${getApiBaseUrl()}/api/remote-capture/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: currentIncomingSnapTask.requestId,
        face_descriptor: descriptorArray
      })
    });

    dismissRemoteSnap();
    alert(`Photo for "${targetStudentName}" sent to PC successfully!`);

  } catch (err) {
    alert("Failed to submit photo: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "SNAP & SEND";
  }
}

function dismissRemoteSnap() {
  const modal = document.getElementById('incoming-snap-modal');
  if (modal) modal.classList.add('hidden');
  if (snapCameraStream) {
    snapCameraStream.getTracks().forEach(t => t.stop());
    snapCameraStream = null;
  }
  if (currentIncomingSnapTask && currentIncomingSnapTask.requestId) {
    fetch(`${getApiBaseUrl()}/api/remote-capture/dismiss/${currentIncomingSnapTask.requestId}`, { method: 'POST' }).catch(() => {});
  }
  currentIncomingSnapTask = null;

  // Restore scanner camera if on scanner screen
  const scannerTab = document.getElementById('tab-scanner');
  if (scannerTab && !scannerTab.classList.contains('hidden')) {
    startScannerCamera();
  }
}

// Local Capture face descriptor for Registration
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

  const primaryPhone = document.getElementById('reg-parent-phone').value.trim();
  const secondaryPhone = document.getElementById('reg-secondary-phone').value.trim();

  const payload = {
    name: document.getElementById('reg-name').value.trim(),
    roll_no: document.getElementById('reg-roll').value.trim(),
    batch: document.getElementById('reg-batch').value || 'Basic Computer',
    father_name: document.getElementById('reg-father').value.trim(),
    mother_name: document.getElementById('reg-mother').value.trim(),
    parent_phone: primaryPhone,
    secondary_phone: secondaryPhone,
    face_descriptor: capturedRegistrationDescriptor
  };

  const submitBtn = document.getElementById('btn-submit-reg');
  submitBtn.disabled = true;
  submitBtn.innerText = "Registering & Sending WhatsApp...";

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/students/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");

    alert(`Student "${payload.name}" registered successfully!\nWelcome message dispatched to parent(s).`);
    document.getElementById('register-form').reset();
    capturedRegistrationDescriptor = null;
    document.getElementById('face-captured-indicator').innerHTML = `<span class="text-amber-400"><i class="fa-solid fa-circle-exclamation mr-1"></i> Not captured</span>`;

    // Hide secondary phone container
    document.getElementById('secondary-phone-container').classList.add('hidden');
    document.getElementById('btn-toggle-secondary-phone').classList.remove('hidden');

    const banner = document.getElementById('remote-status-banner');
    if (banner) banner.classList.add('hidden');

    generateAutoRollNumber();
    await reloadRegisteredFaces();
    switchTab('scan');
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = "SAVE & REGISTER STUDENT (SENDS WHATSAPP WELCOME)";
  }
}

// ================= BATCHES MANAGEMENT ================= //
async function loadBatches() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/batches/list`);
    const batches = await res.json();
    allBatchesCache = batches;

    // 1. Populate Register Form Batch Select
    const regBatchSelect = document.getElementById('reg-batch');
    if (regBatchSelect) {
      const currentVal = regBatchSelect.value;
      regBatchSelect.innerHTML = batches.map(b => `
        <option value="${b.name}">${b.name}</option>
      `).join('');
      if (currentVal && batches.some(b => b.name === currentVal)) {
        regBatchSelect.value = currentVal;
      }
    }

    // 2. Populate Edit Modal Batch Select
    const editBatchSelect = document.getElementById('edit-student-batch');
    if (editBatchSelect) {
      editBatchSelect.innerHTML = batches.map(b => `
        <option value="${b.name}">${b.name}</option>
      `).join('');
    }

    // 3. Render Batches List in Admin Mode
    const container = document.getElementById('batches-list-container');
    if (container) {
      if (batches.length === 0) {
        container.innerHTML = `<div class="text-xs text-slate-500 py-3">No batches created yet. Add one above.</div>`;
      } else {
        container.innerHTML = batches.map(b => `
          <div class="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div class="flex items-center space-x-2.5">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
              <span class="text-xs md:text-sm font-bold text-white">${b.name}</span>
            </div>
            <button onclick="deleteBatch(${b.id}, '${b.name.replace(/'/g, "\\'")}')" class="px-2.5 py-1 rounded-xl bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/20 text-xs font-semibold transition">
              <i class="fa-solid fa-trash-can mr-1"></i> Delete
            </button>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error("Error loading batches:", err);
  }
}

async function addNewBatch() {
  const input = document.getElementById('new-batch-name');
  const name = input ? input.value.trim() : '';

  if (!name) {
    alert("Please enter a batch name!");
    input?.focus();
    return;
  }

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/batches/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to add batch");

    input.value = '';
    await loadBatches();
    alert(`Batch "${name}" added successfully!`);
  } catch (err) {
    alert("Error adding batch: " + err.message);
  }
}

async function deleteBatch(id, name) {
  if (!confirm(`Are you sure you want to remove batch "${name}"?`)) {
    return;
  }

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/batches/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      await loadBatches();
    } else {
      alert("Failed to delete batch: " + (data.error || "Unknown error"));
    }
  } catch (err) {
    alert("Error deleting batch: " + err.message);
  }
}

// ================= ADMIN MODE: REGISTERED STUDENTS & EDITING ================= //
async function loadAdminStudents() {
  const container = document.getElementById('admin-students-list');
  if (!container) return;
  container.innerHTML = `<div class="text-center py-6 text-xs text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Loading student directory...</div>`;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/students/list`);
    const students = await res.json();
    allStudentsCache = students;

    const countEl = document.getElementById('admin-students-count');
    if (countEl) countEl.innerText = students.length;

    renderStudentsList(students);
  } catch (err) {
    container.innerHTML = `<div class="text-center py-6 text-xs text-rose-400">Failed to load student directory.</div>`;
  }
}

function renderStudentsList(students) {
  const container = document.getElementById('admin-students-list');
  if (!container) return;

  if (students.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-xs text-slate-500">No students registered yet.</div>`;
    return;
  }

  container.innerHTML = students.map(st => {
    const phoneList = [st.parent_phone];
    if (st.secondary_phone) phoneList.push(st.secondary_phone);

    const parentsInfo = [];
    if (st.father_name) parentsInfo.push(`F: ${st.father_name}`);
    if (st.mother_name) parentsInfo.push(`M: ${st.mother_name}`);
    const parentsStr = parentsInfo.length > 0 ? `• ${parentsInfo.join(', ')}` : '';

    return `
      <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 hover:border-slate-700 transition">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm font-black">
            ${st.name.charAt(0)}
          </div>
          <div>
            <div class="flex items-center space-x-2">
              <h4 class="text-xs md:text-sm font-extrabold text-white leading-tight">${st.name}</h4>
              <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-800 text-teal-300 font-mono">
                ${st.roll_no}
              </span>
            </div>
            <div class="flex flex-wrap items-center space-x-2 text-[10px] text-slate-400 font-mono mt-1">
              <span class="text-emerald-400 font-semibold">${st.batch || 'Basic Computer'}</span>
              <span>${parentsStr}</span>
              <span>•</span>
              <span class="text-slate-300"><i class="fa-brands fa-whatsapp text-emerald-400"></i> ${phoneList.join(', ')}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center space-x-2">
          <button onclick="openEditStudentModal(${st.id})" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center space-x-1.5">
            <i class="fa-solid fa-pen-to-square text-xs text-emerald-400"></i>
            <span>Edit</span>
          </button>
          <button onclick="deleteStudent(${st.id}, '${st.name.replace(/'/g, "\\'")}')" class="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/20 text-xs font-bold transition flex items-center space-x-1.5">
            <i class="fa-solid fa-trash-can text-xs"></i>
            <span class="hidden sm:inline">Delete</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function filterAdminStudents() {
  const query = (document.getElementById('admin-student-search')?.value || '').toLowerCase().trim();
  if (!query) {
    renderStudentsList(allStudentsCache);
    return;
  }

  const filtered = allStudentsCache.filter(st => {
    return (st.name && st.name.toLowerCase().includes(query)) ||
           (st.roll_no && st.roll_no.toLowerCase().includes(query)) ||
           (st.batch && st.batch.toLowerCase().includes(query)) ||
           (st.parent_phone && st.parent_phone.includes(query)) ||
           (st.secondary_phone && st.secondary_phone.includes(query)) ||
           (st.father_name && st.father_name.toLowerCase().includes(query)) ||
           (st.mother_name && st.mother_name.toLowerCase().includes(query));
  });

  renderStudentsList(filtered);
}

// Student Edit Modal
function openEditStudentModal(studentId) {
  const student = allStudentsCache.find(s => s.id === studentId);
  if (!student) return;

  document.getElementById('edit-student-id').value = student.id;
  document.getElementById('edit-student-name').value = student.name || '';
  document.getElementById('edit-student-roll').value = student.roll_no || '';
  document.getElementById('edit-student-father').value = student.father_name || '';
  document.getElementById('edit-student-mother').value = student.mother_name || '';
  document.getElementById('edit-student-phone').value = student.parent_phone || '';
  document.getElementById('edit-student-sec-phone').value = student.secondary_phone || '';

  const batchSelect = document.getElementById('edit-student-batch');
  if (batchSelect) {
    batchSelect.value = student.batch || 'Basic Computer';
  }

  document.getElementById('edit-student-modal').classList.remove('hidden');
}

function closeEditStudentModal() {
  document.getElementById('edit-student-modal').classList.add('hidden');
}

async function saveStudentEdits(e) {
  e.preventDefault();

  const studentId = document.getElementById('edit-student-id').value;
  const payload = {
    name: document.getElementById('edit-student-name').value.trim(),
    batch: document.getElementById('edit-student-batch').value,
    father_name: document.getElementById('edit-student-father').value.trim(),
    mother_name: document.getElementById('edit-student-mother').value.trim(),
    parent_phone: document.getElementById('edit-student-phone').value.trim(),
    secondary_phone: document.getElementById('edit-student-sec-phone').value.trim()
  };

  const btn = document.getElementById('btn-save-edit');
  btn.disabled = true;
  btn.innerText = "Saving...";

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/students/${studentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Update failed");

    closeEditStudentModal();
    await reloadRegisteredFaces();
    await loadAdminStudents();
    alert("Student details updated successfully!");
  } catch (err) {
    alert("Error updating student: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Save Changes";
  }
}

// Delete student
async function deleteStudent(studentId, name) {
  if (!confirm(`Are you sure you want to remove student "${name}"? This will delete their facial profile.`)) {
    return;
  }

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/students/${studentId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      await reloadRegisteredFaces();
      loadAdminStudents();
    } else {
      alert("Failed to delete student: " + (data.error || "Unknown error"));
    }
  } catch (err) {
    alert("Error deleting student: " + err.message);
  }
}

// ================= EXPORT TO EXCEL ================= //
function exportStudentsToExcel() {
  if (!allStudentsCache || allStudentsCache.length === 0) {
    alert("No student records available to export!");
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert("Excel export library is loading. Please check internet connection.");
    return;
  }

  const excelData = allStudentsCache.map((st, index) => ({
    "S.No": index + 1,
    "Roll No": st.roll_no || '',
    "Student Name": st.name || '',
    "Batch / Course": st.batch || 'Basic Computer',
    "Father Name": st.father_name || '',
    "Mother Name": st.mother_name || '',
    "Primary Phone": st.parent_phone || '',
    "Secondary Phone": st.secondary_phone || '',
    "Registration Date": st.created_at ? new Date(st.created_at).toLocaleDateString() : ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(excelData);

  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 22 },
    { wch: 18 },
    { wch: 20 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Students");

  const today = new Date().toISOString().split('T')[0];
  const filename = `DOT_CMC_Students_${today}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

// 8. Load Attendance Logs
async function loadAttendanceLogs() {
  const container = document.getElementById('logs-list-container');
  if (!container) return;
  container.innerHTML = `<div class="text-center py-6 text-xs text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Loading attendance logs...</div>`;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/attendance/logs`);
    const logs = await res.json();

    if (logs.length === 0) {
      container.innerHTML = `<div class="text-center py-8 text-xs text-slate-500">No attendance recorded today yet.</div>`;
      return;
    }

    container.innerHTML = logs.map(row => {
      const isSuccess = row.whatsapp_status === 'SENT' || row.whatsapp_status === 'SIMULATED';
      const isExit = row.type === 'EXIT';
      const badgeStyle = isSuccess 
        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20';

      const timeStr = new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

      return `
        <div class="p-3 rounded-2xl bg-slate-900/80 border border-slate-800/80 flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 rounded-xl ${isExit ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'} flex items-center justify-center text-xs font-bold">
              ${row.student_name.charAt(0)}
            </div>
            <div>
              <div class="flex items-center space-x-2">
                <h4 class="text-xs font-bold text-white leading-tight">${row.student_name}</h4>
                <span class="px-1.5 py-0.5 rounded text-[9px] font-black ${isExit ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}">
                  ${isExit ? 'EXIT' : 'ENTRY'}
                </span>
              </div>
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

// 9. WhatsApp Status & QR Code (Web PC only)
let qrPollingInterval = null;

async function checkWhatsAppStatus() {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) return; // Not needed on staff phone

  const textEl = document.getElementById('wa-status-text');
  const pill = document.getElementById('wa-pill');

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/whatsapp/status`);
    const data = await res.json();

    if (data.config.simulate) {
      if (textEl) textEl.innerText = "Simulated";
      if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400";
    } else if (data.service && (data.service.status === 'authenticated' || data.service.status === 'ready' || data.service.status === 'CONNECTED')) {
      if (textEl) textEl.innerText = (data.service.pushName || 'WhatsApp Active');
      if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400";
      closeQRCodeModal();
    } else if (data.service && data.service.status === 'qr_ready') {
      if (textEl) textEl.innerText = "Link WhatsApp";
      if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 animate-pulse";
    } else {
      if (textEl) textEl.innerText = "Link WhatsApp";
      if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400";
    }
  } catch (err) {
    if (textEl) textEl.innerText = "Link WhatsApp";
    if (pill) pill.className = "cursor-pointer inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400";
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
    checkWhatsAppStatus();
  } catch (err) {
    console.error("Failed to fetch QR code:", err);
  }
}
