// Deconstruct AI — Core Client Orchestrator & Canvas Engine

// App State
const state = {
  token: localStorage.getItem('token') || null,
  username: localStorage.getItem('username') || null,
  activeRefSource: 'file', // 'file' | 'url'
  activeAssetSource: 'file', // 'file' | 'url'
  refFileBase64: null,
  assetFileBase64: null,
  generatedImageBlob: null,
  activeDesignType: 'YouTube Thumbnail',
  history: [],
  canvasZoom: 1.0,
  isGridVisible: true,
  currentDesign: null
};

// API Endpoint configuration
const API_URL = window.location.origin;

// DOM Elements
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const authAlert = document.getElementById('auth-alert');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const tabLoginBtn = document.getElementById('tab-login-btn');
const tabRegisterBtn = document.getElementById('tab-register-btn');
const usernameDisplay = document.getElementById('username-display');
const userInitials = document.getElementById('user-initials');
const designHistoryList = document.getElementById('design-history-list');
const designConfigForm = document.getElementById('design-config-form');
const canvasRatioBadge = document.getElementById('canvas-ratio-badge');
const downloadBtn = document.getElementById('download-design-btn');
const loaderOverlay = document.getElementById('loader-overlay');
const renderCanvas = document.getElementById('render-canvas');
const ctx = renderCanvas.getContext('2d');
const coordinateGridOverlay = document.getElementById('coordinate-grid-overlay');
const canvasContainer = document.getElementById('canvas-container');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  if (state.token) {
    checkTokenAndInitialize();
  } else {
    showAuthView();
  }
  updateDesignTypeSelection();
});

// ----------------------------------------------------
// Authentication Logic
// ----------------------------------------------------

function showAuthView() {
  authSection.classList.remove('hidden');
  dashboardSection.classList.add('hidden');
}

function showDashboardView() {
  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  usernameDisplay.textContent = state.username;
  userInitials.textContent = state.username.substring(0, 2).toUpperCase();
  loadHistory();
}

async function checkTokenAndInitialize() {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    if (res.ok) {
      const data = await res.json();
      state.username = data.username;
      localStorage.setItem('username', data.username);
      showDashboardView();
    } else {
      handleLogout();
    }
  } catch (err) {
    console.error('Failed to verify token', err);
    showDashboardView(); // Offline fallback for resilience
  }
}

function switchAuthTab(tab) {
  authAlert.classList.add('hidden');
  if (tab === 'login') {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  } else {
    tabLoginBtn.classList.remove('active');
    tabRegisterBtn.classList.add('active');
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username').value;
  const passwordInput = document.getElementById('login-password').value;
  
  showAuthAlert(null); // Clear
  
  try {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });
    
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      state.token = data.token;
      state.username = data.username;
      showDashboardView();
    } else {
      showAuthAlert(data.message || 'Login failed.', 'error');
    }
  } catch (err) {
    showAuthAlert('Server unreachable.', 'error');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('register-username').value;
  const passwordInput = document.getElementById('register-password').value;
  
  showAuthAlert(null); // Clear
  
  try {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });
    
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      state.token = data.token;
      state.username = data.username;
      showDashboardView();
    } else {
      showAuthAlert(data.message || 'Registration failed.', 'error');
    }
  } catch (err) {
    showAuthAlert('Server unreachable.', 'error');
  }
}

function handleLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  state.token = null;
  state.username = null;
  state.history = [];
  showAuthView();
}

function showAuthAlert(msg, type = 'error') {
  if (!msg) {
    authAlert.classList.add('hidden');
    return;
  }
  authAlert.textContent = msg;
  authAlert.className = `alert alert-${type}`;
}

// ----------------------------------------------------
// UI Logic & Form Interactions
// ----------------------------------------------------

function switchSourceInput(type, source) {
  if (type === 'ref') {
    state.activeRefSource = source;
    document.getElementById('ref-toggle-file').classList.toggle('active', source === 'file');
    document.getElementById('ref-toggle-url').classList.toggle('active', source === 'url');
    document.getElementById('ref-file-container').classList.toggle('hidden', source !== 'file');
    document.getElementById('ref-url-container').classList.toggle('hidden', source !== 'url');
  } else if (type === 'asset') {
    state.activeAssetSource = source;
    document.getElementById('asset-toggle-file').classList.toggle('active', source === 'file');
    document.getElementById('asset-toggle-url').classList.toggle('active', source === 'url');
    document.getElementById('asset-file-container').classList.toggle('hidden', source !== 'file');
    document.getElementById('asset-url-container').classList.toggle('hidden', source !== 'url');
  }
}

function handleFileSelected(type, input) {
  const file = input.files[0];
  const label = document.getElementById(`${type}-file-name`);
  
  if (!file) {
    label.textContent = '';
    if (type === 'ref') state.refFileBase64 = null;
    if (type === 'asset') state.assetFileBase64 = null;
    return;
  }
  
  label.textContent = `Selected: ${file.name}`;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    if (type === 'ref') state.refFileBase64 = e.target.result;
    if (type === 'asset') state.assetFileBase64 = e.target.result;
  };
  reader.readAsDataURL(file);
}

function updateDesignTypeSelection() {
  const activeRadio = document.querySelector('input[name="designType"]:checked');
  if (!activeRadio) return;
  
  state.activeDesignType = activeRadio.value;
  
  // Highlight card element
  document.querySelectorAll('.design-type-card').forEach(card => {
    const radio = card.querySelector('input');
    card.classList.toggle('active', radio.checked);
  });

  // Render format tag
  let ratioStr = '16:9';
  if (state.activeDesignType === 'LinkedIn Carousel') ratioStr = '1:1';
  else if (state.activeDesignType === 'Event Flyer') ratioStr = '4:5';
  else if (state.activeDesignType === 'Twitter Banner') ratioStr = '3:1';

  canvasRatioBadge.innerHTML = `<i class="fa-solid fa-crop-simple"></i> Ratio: ${ratioStr}`;
}

// ----------------------------------------------------
// Flowise Layout Extract & n8n Orchestrator Logic
// ----------------------------------------------------

async function handleGenerateDesign(e) {
  e.preventDefault();
  
  const headlineVal = document.getElementById('headline-input').value;
  const refUrlVal = document.getElementById('ref-url-input').value;
  const assetUrlVal = document.getElementById('asset-url-input').value;
  const bgColorVal = document.getElementById('color-bg').value;
  const accentColorVal = document.getElementById('color-accent').value;
  const textHighlightColorVal = document.getElementById('color-highlight').value;
  
  // Validate file uploads if they are toggled
  if (state.activeRefSource === 'file' && !state.refFileBase64) {
    alert('Please upload a style reference design template file.');
    return;
  }
  if (state.activeAssetSource === 'file' && !state.assetFileBase64) {
    alert('Please upload your asset photo.');
    return;
  }

  // Show dynamic stepping loader
  showLoader();

  const payload = {
    designType: state.activeDesignType,
    userCopyText: headlineVal,
    brandPalette: [bgColorVal, accentColorVal, textHighlightColorVal, '#ffffff'],
    referenceImageUrl: state.activeRefSource === 'url' ? refUrlVal : null,
    referenceImageFile: state.activeRefSource === 'file' ? state.refFileBase64 : null,
    userAssetUrl: state.activeAssetSource === 'url' ? assetUrlVal : null,
    userAssetFile: state.activeAssetSource === 'file' ? state.assetFileBase64 : null
  };

  try {
    // Step 0: Triggering webhook (0 - 800ms)
    await animateStep(0, 1000);
    
    // Step 1: LLM Vision Analysis (1000 - 2200ms)
    await animateStep(1, 1500);

    // Call actual backend router
    const res = await fetch(`${API_URL}/api/designs/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('API Request failed');
    const data = await res.json();

    // Step 2: Vector Syncing to Pinecone (2200 - 3200ms)
    await animateStep(2, 1000);

    // Step 3: Draw Canvas output (3200 - 4000ms)
    await animateStep(3, 800);

    // Finalize Generation
    state.currentDesign = data.design;
    await drawDesignOnCanvas(data.design, payload.userAssetFile || payload.userAssetUrl);
    
    hideLoader();
    loadHistory(); // Refresh history panel
  } catch (err) {
    console.error(err);
    alert('Generation error. Please check server connections.');
    hideLoader();
  }
}

// Loader animation helper
function showLoader() {
  loaderOverlay.classList.remove('hidden');
  document.querySelectorAll('.step-item').forEach((item, index) => {
    item.className = index === 0 ? 'step-item active' : 'step-item';
    item.querySelector('.step-icon').className = index === 0 
      ? 'fa-solid fa-circle-notch fa-spin step-icon' 
      : 'fa-regular fa-circle step-icon';
  });
}

function hideLoader() {
  loaderOverlay.classList.add('hidden');
}

async function animateStep(stepIdx, duration) {
  return new Promise(resolve => {
    setTimeout(() => {
      // Mark current step as completed
      const curStep = document.getElementById(`step-${stepIdx}`);
      curStep.className = 'step-item completed';
      curStep.querySelector('.step-icon').className = 'fa-solid fa-circle-check step-icon';
      
      // Activate next step
      const nextStep = document.getElementById(`step-${stepIdx + 1}`);
      if (nextStep) {
        nextStep.className = 'step-item active';
        nextStep.querySelector('.step-icon').className = 'fa-solid fa-circle-notch fa-spin step-icon';
      }
      resolve();
    }, duration);
  });
}

// ----------------------------------------------------
// Dynamic Canvas Compositing Engine (Client-Side Rendering)
// ----------------------------------------------------

async function drawDesignOnCanvas(design, userAssetImageSource) {
  const schema = design.layoutSchema;
  
  // Set dimensions based on extracted schema layout sizes
  renderCanvas.width = schema.canvasSize.width;
  renderCanvas.height = schema.canvasSize.height;
  
  // Draw Background Layer
  const grad = ctx.createLinearGradient(0, 0, renderCanvas.width, renderCanvas.height);
  grad.addColorStop(0, schema.palette[0] || '#0f172a');
  grad.addColorStop(1, adjustColorBrightness(schema.palette[0] || '#0f172a', -20));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

  // Overlay visual abstract design grids/circles in background
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < renderCanvas.width; i += 80) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, renderCanvas.height);
    ctx.stroke();
  }
  for (let j = 0; j < renderCanvas.height; j += 80) {
    ctx.beginPath();
    ctx.moveTo(0, j);
    ctx.lineTo(renderCanvas.width, j);
    ctx.stroke();
  }
  
  // Accent brand gradient blob
  ctx.globalAlpha = 0.15;
  const radialGrad = ctx.createRadialGradient(
    renderCanvas.width / 2, renderCanvas.height / 2, 100, 
    renderCanvas.width / 2, renderCanvas.height / 2, renderCanvas.width / 2
  );
  radialGrad.addColorStop(0, schema.palette[1] || '#6366f1');
  radialGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = radialGrad;
  ctx.beginPath();
  ctx.arc(renderCanvas.width / 2, renderCanvas.height / 2, renderCanvas.width / 2, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.globalAlpha = 1.0; // Reset

  // Draw User Asset Image
  if (userAssetImageSource) {
    try {
      const img = await loadImage(userAssetImageSource);
      ctx.save();
      
      const config = schema.assetConfig;
      // Handle clipping bounds (round for avatar, rounded rectangle for regular)
      if (design.designType === 'LinkedIn Carousel' || design.designType === 'Twitter Banner') {
        // Circle crop
        ctx.beginPath();
        const centerX = config.x + config.width / 2;
        const centerY = config.y + config.height / 2;
        const radius = config.width / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.clip();
      } else {
        // Rounded Rect crop
        drawRoundedRect(ctx, config.x, config.y, config.width, config.height, config.borderRadius || 16);
        ctx.clip();
      }

      // Draw and scale user asset to cover box
      const scale = Math.max(config.width / img.width, config.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = config.x + (config.width - w) / 2;
      const y = config.y + (config.height - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      
      // Draw outer accent border around asset
      ctx.strokeStyle = schema.palette[1] || '#6366f1';
      ctx.lineWidth = 4;
      if (design.designType === 'LinkedIn Carousel' || design.designType === 'Twitter Banner') {
        ctx.beginPath();
        ctx.arc(config.x + config.width/2, config.y + config.height/2, config.width/2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        drawRoundedRect(ctx, config.x, config.y, config.width, config.height, config.borderRadius || 16);
        ctx.stroke();
      }
    } catch (err) {
      console.warn('Could not load user asset image, drawing fallback avatar card', err);
      drawFallbackAssetCard(schema.assetConfig, schema.palette);
    }
  } else {
    drawFallbackAssetCard(schema.assetConfig, schema.palette);
  }

  // Draw Headline Typography Text Layer
  ctx.fillStyle = schema.textConfig.color;
  ctx.font = `${schema.textConfig.fontWeight} ${schema.textConfig.fontSize}px ${schema.textConfig.fontFamily}`;
  ctx.textAlign = schema.textConfig.align;
  ctx.textBaseline = 'middle';

  const textLines = wrapText(ctx, design.userCopyText, schema.textConfig.maxWidth);
  let currentY = schema.textConfig.y - ((textLines.length - 1) * schema.textConfig.lineHeight) / 2;

  textLines.forEach(line => {
    // Add glowing shadow effect under the text to highlight contrast
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    
    // Draw Text Stroke for high legibility
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(line, schema.textConfig.x, currentY);
    
    // Fill text color
    ctx.fillText(line, schema.textConfig.x, currentY);
    currentY += schema.textConfig.lineHeight;
  });

  // Reset shadow attributes
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Draw overlay coordinate guidelines if toggled
  drawCoordinateOverlayGrid(design);

  // Enable download action
  downloadBtn.removeAttribute('disabled');
}

// Canvas Utility Functions
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function drawRoundedRect(c, x, y, width, height, radius) {
  c.beginPath();
  c.moveTo(x + radius, y);
  c.lineTo(x + width - radius, y);
  c.quadraticCurveTo(x + width, y, x + width, y + radius);
  c.lineTo(x + width, y + height - radius);
  c.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  c.lineTo(x + radius, y + height);
  c.quadraticCurveTo(x, y + height, x, y + height - radius);
  c.lineTo(x, y + radius);
  c.quadraticCurveTo(x, y, x + radius, y);
  c.closePath();
}

function drawFallbackAssetCard(config, palette) {
  ctx.fillStyle = palette[2] || '#10b981';
  drawRoundedRect(ctx, config.x, config.y, config.width, config.height, config.borderRadius || 16);
  ctx.fill();
  
  // Draw generic camera/image icon in center
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px "Font Awesome 6 Free"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('', config.x + config.width/2, config.y + config.height/2); // FA image icon
}

function wrapText(c, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = c.measureText(currentLine + " " + word).width;
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

function adjustColorBrightness(hex, percent) {
  let R = parseInt(hex.substring(1, 3), 16);
  let G = parseInt(hex.substring(3, 5), 16);
  let B = parseInt(hex.substring(5, 7), 16);

  R = parseInt(R * (100 + percent) / 100);
  G = parseInt(G * (100 + percent) / 100);
  B = parseInt(B * (100 + percent) / 100);

  R = (R < 255) ? R : 255;  
  G = (G < 255) ? G : 255;  
  B = (B < 255) ? B : 255;  

  R = (R > 0) ? R : 0;
  G = (G > 0) ? G : 0;
  B = (B > 0) ? B : 0;

  const rHex = R.toString(16).padStart(2, '0');
  const gHex = G.toString(16).padStart(2, '0');
  const bHex = B.toString(16).padStart(2, '0');

  return `#${rHex}${gHex}${bHex}`;
}

// ----------------------------------------------------
// Interactive Coordinates Grid Mapping
// ----------------------------------------------------

function drawCoordinateOverlayGrid(design) {
  // Clear the transparent HTML overlay
  coordinateGridOverlay.innerHTML = '';
  
  if (!state.isGridVisible) return;

  const schema = design.layoutSchema;
  
  // Calculate relative scaling based on visual container width
  const renderWidth = renderCanvas.clientWidth;
  const actualWidth = renderCanvas.width;
  const ratio = renderWidth / actualWidth;

  // 1. Text Bounding Box Marker
  const textX = schema.textConfig.align === 'center'
    ? schema.textConfig.x - schema.textConfig.maxWidth / 2
    : schema.textConfig.x;
  
  // Mock bounding height approx based on font size and lines
  const textLinesCount = wrapText(ctx, design.userCopyText, schema.textConfig.maxWidth).length;
  const boxH = textLinesCount * schema.textConfig.lineHeight;
  const boxY = schema.textConfig.y - boxH / 2;

  createTextMarkerElement(
    textX * ratio,
    boxY * ratio,
    schema.textConfig.maxWidth * ratio,
    boxH * ratio,
    `Text Layout Box: X=${schema.textConfig.x}, Y=${schema.textConfig.y}`
  );

  // 2. Asset Box Marker
  const asset = schema.assetConfig;
  createTextMarkerElement(
    asset.x * ratio,
    asset.y * ratio,
    asset.width * ratio,
    asset.height * ratio,
    `Asset Bounding: X=${asset.x}, Y=${asset.y}, Size=${asset.width}x${asset.height}`
  );
}

function createTextMarkerElement(left, top, w, h, label) {
  const box = document.createElement('div');
  box.className = 'grid-marker-box';
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  
  const textLabel = document.createElement('span');
  textLabel.className = 'grid-marker-label';
  textLabel.textContent = label;
  
  box.appendChild(textLabel);
  coordinateGridOverlay.appendChild(box);
}

function toggleCoordinateGrid() {
  state.isGridVisible = !state.isGridVisible;
  if (state.currentDesign) {
    drawDesignOnCanvas(state.currentDesign, null); // Refills canvas and grid overlay state
  }
}

// ----------------------------------------------------
// Zoom Actions
// ----------------------------------------------------

function zoomCanvas(amount) {
  state.canvasZoom = Math.min(Math.max(state.canvasZoom + amount, 0.4), 2.5);
  canvasContainer.style.transform = `scale(${state.canvasZoom})`;
}

function resetZoom() {
  state.canvasZoom = 1.0;
  canvasContainer.style.transform = `scale(1.0)`;
}

// ----------------------------------------------------
// Download Result Image
// ----------------------------------------------------

function downloadGeneratedDesign() {
  if (!state.currentDesign) return;
  
  const image = renderCanvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = image;
  link.download = `deconstruct-ai-${state.currentDesign.designType.toLowerCase().replace(' ', '-')}-${Date.now()}.png`;
  link.click();
}

// ----------------------------------------------------
// Portfolio History Panel Loading
// ----------------------------------------------------

async function loadHistory() {
  try {
    const res = await fetch(`${API_URL}/api/designs/history`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    if (res.ok) {
      const data = await res.json();
      state.history = data;
      renderHistoryList();
    }
  } catch (err) {
    console.error('Failed to load portfolio history', err);
  }
}

function renderHistoryList() {
  designHistoryList.innerHTML = '';
  
  if (state.history.length === 0) {
    designHistoryList.innerHTML = `
      <div class="history-empty">
        <i class="fa-regular fa-folder-open"></i>
        <p>No designs generated yet</p>
      </div>`;
    return;
  }

  state.history.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.onclick = () => loadHistoricalDesign(item);
    
    const formattedDate = new Date(item.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = `
      <div class="history-header">
        <span class="history-type">${item.designType}</span>
        <span class="history-date">${formattedDate}</span>
      </div>
      <div class="history-copy">${item.userCopyText}</div>
    `;
    
    designHistoryList.appendChild(card);
  });
}

function loadHistoricalDesign(design) {
  state.currentDesign = design;
  
  // Update configuration form values
  document.getElementById('headline-input').value = design.userCopyText;
  
  // Set active design type radio button
  const radios = document.getElementsByName('designType');
  radios.forEach(radio => {
    if (radio.value === design.designType) {
      radio.checked = true;
      updateDesignTypeSelection();
    }
  });

  // Re-draw design with default asset avatar clip
  drawDesignOnCanvas(design, null);
}
