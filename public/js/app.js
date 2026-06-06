// Deconstruct AI — Core Client Orchestrator

// App State
const state = {
  token: localStorage.getItem('token') || null,
  username: localStorage.getItem('username') || null,
  activeRefSource: 'file', // 'file' | 'url'
  activeAssetSource: 'file', // 'file' | 'url'
  refFilesBase64: [],
  assetFilesBase64: [],
  generatedImageBlob: null,
  activeDesignType: 'YouTube Thumbnail',
  generationMode: 'single',
  history: [],
  templates: [],
  selectedTemplateId: null,
  selectedTemplate: null,
  templateLoadingId: null,
  templateLoadRequestId: 0,
  currentDesign: null,
  activeSlideIndex: 0,
  totalSlidesCount: 1
};
window.deconstructState = state;

// API Endpoint configuration
const API_URL = window.location.origin;

function siblingServiceOrigin(port) {
  const url = new URL(window.location.origin);
  url.port = String(port);
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

const SERVICE_URLS = {
  n8n: siblingServiceOrigin(5678),
  flowise: siblingServiceOrigin(3000)
};

function resolveReachableUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return url
    .replace(/^http:\/\/localhost(?::\d+)?/i, API_URL)
    .replace(/^http:\/\/127\.0\.0\.1(?::\d+)?/i, API_URL);
}

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
const templateList = document.getElementById('template-list');
const designConfigForm = document.getElementById('design-config-form');
const canvasRatioBadge = document.getElementById('canvas-ratio-badge');
const downloadBtn = document.getElementById('download-design-btn');
const loaderOverlay = document.getElementById('loader-overlay');
const renderCanvas = document.getElementById('render-canvas');
const ctx = renderCanvas.getContext('2d');
const generationEvidencePill = document.getElementById('generation-evidence-pill');
const selectedTemplateCard = document.getElementById('selected-template-card');
const templateRuleViewer = document.getElementById('template-rule-viewer');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  if (state.token) {
    checkTokenAndInitialize();
  } else {
    showAuthView();
  }
  updateDesignTypeSelection();
  updateGenerationModeSelection();
  setupFileDropZones();
  ensureUiFeedbackElements();
  if (state.token) loadIntegrationStatus();
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
  loadTemplates();
  loadIntegrationStatus();
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
    showAuthView();
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
  state.templates = [];
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

function normalizeImageDataUrl(dataUrl, { maxDimension = 1280, quality = 0.84, anonymize = false } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (anonymize) {
        ctx.filter = 'blur(10px) saturate(0.8) contrast(0.9)';
      }
      ctx.drawImage(img, 0, 0, width, height);
      ctx.filter = 'none';
      if (anonymize) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
      }
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function handleFileSelected(type, input) {
  const files = Array.from(input.files);
  const label = document.getElementById(`${type}-file-name`);
  
  if (files.length === 0) {
    label.textContent = '';
    if (type === 'ref') state.refFilesBase64 = [];
    if (type === 'asset') state.assetFilesBase64 = [];
    return;
  }
  
  label.textContent = `Selected: ${files.length} file(s) — preparing...`;
  
  try {
    const base64Array = await Promise.all(files.map(async (file) => {
      const dataUrl = await readFileAsDataUrl(file);
      if (!file.type.startsWith('image/')) return dataUrl;
      return normalizeImageDataUrl(dataUrl, { maxDimension: type === 'ref' ? 1024 : 256, quality: type === 'ref' ? 0.84 : 0.72, anonymize: type === 'asset' });
    }));
    if (type === 'ref') state.refFilesBase64 = base64Array;
    if (type === 'asset') state.assetFilesBase64 = base64Array;
    label.textContent = `Selected: ${files.length} file(s)`;
  } catch (error) {
    label.textContent = 'Could not prepare selected image file(s).';
    showToast(error.message || 'Could not prepare selected image file(s).', 'error');
  }
}


function updateGenerationModeSelection() {
  const activeRadio = document.querySelector('input[name="generationMode"]:checked');
  if (!activeRadio) return;
  state.generationMode = activeRadio.value;
  document.querySelectorAll('.generation-mode-card').forEach(card => {
    const radio = card.querySelector('input');
    card.classList.toggle('active', Boolean(radio?.checked));
  });
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
// Template Rule Creation + Image Generation Logic
// ----------------------------------------------------

async function handleCreateTemplateRule() {
  const refUrlVal = document.getElementById('ref-url-input').value;
  if (state.activeRefSource === 'file' && state.refFilesBase64.length === 0) {
    showToast('Upload a real reference design image before creating template rules.', 'error');
    return;
  }
  if (state.activeRefSource === 'url' && !refUrlVal) {
    showToast('Provide a real reference design URL before creating template rules.', 'error');
    return;
  }

  const payload = {
    designType: state.activeDesignType,
    generationMode: state.generationMode,
    referenceImageUrls: state.activeRefSource === 'url' ? [resolveReachableUrl(refUrlVal)] : [],
    referenceImageFiles: state.activeRefSource === 'file' ? state.refFilesBase64 : []
  };

  showLoader();
  try {
    await animateStep(0, 500);
    await animateStep(1, 500);
    const res = await fetch(`${API_URL}/api/templates/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Template-rule creation failed.');

    state.selectedTemplateId = data.template.templateId;
    state.selectedTemplate = data.template;
    state.templates = [
      {
        templateId: data.template.templateId,
        designType: data.template.designType,
        mode: data.template.mode,
        summary: data.template.summary,
        source: data.template.source,
        referenceImageCount: data.template.referenceImageCount || 0,
        assetImageCount: data.template.assetImageCount || 0,
        templateRuleQuality: data.template.templateRuleQuality || null,
        createdAt: data.template.createdAt,
        updatedAt: data.template.updatedAt
      },
      ...state.templates.filter(template => template.templateId !== data.template.templateId)
    ];
    await animateStep(2, 250);
    await animateStep(3, 250);
    renderSelectedTemplate();
    renderTemplateList();
    await loadTemplates();
    showToast('Template rules created and saved.', 'success');
  } catch (err) {
    showToast(err.message || 'Template-rule creation failed.', 'error');
  } finally {
    hideLoader();
  }
}

async function handleGenerateDesign(e) {
  e.preventDefault();
  
  const headlineVal = document.getElementById('headline-input').value;
  const assetUrlVal = document.getElementById('asset-url-input').value;
  if (!state.selectedTemplateId) {
    showToast('Select or create a template rule before generating a design.', 'error');
    return;
  }

  // Validate asset input only. Reference images belong to template-rule creation, not image generation.
  if (state.activeAssetSource === 'file' && state.assetFilesBase64.length === 0) {
    showToast('Please upload one or more asset photos.', 'error');
    return;
  }

  // Parse captions (split by |)
  const headlines = headlineVal.split('|').map(s => s.trim()).filter(Boolean);

  // Show dynamic stepping loader
  showLoader();

  const payload = {
    designType: state.activeDesignType,
    generationMode: state.generationMode,
    userCopyTexts: headlines,
    templateId: state.selectedTemplateId,
    referenceImageUrls: [],
    referenceImageFiles: [],
    userAssetUrls: state.activeAssetSource === 'url' ? [resolveReachableUrl(assetUrlVal)] : [],
    userAssetFiles: state.activeAssetSource === 'file' ? state.assetFilesBase64 : []
  };

  try {
    // Step 0: Triggering webhook (0 - 800ms)
    await animateStep(0, 1000);
    
    // Step 1: n8n + Flowise orchestration setup
    await animateStep(1, 1200);

    // Step 2 stays active while n8n runs Gemini. This can take real time, so avoid
    // pretending the UI is stuck on a legacy vector-store/local-memory status.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    const res = await fetch(`${API_URL}/api/designs/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({}));
      throw new Error(errPayload.message || 'We could not generate the image right now. Please try again.');
    }
    const data = await res.json();

    // Step 2: Gemini image returned from n8n
    await animateStep(2, 300);

    // Step 3: Save/render output image
    await animateStep(3, 300);

    // Finalize Generation
    state.currentDesign = data.design;
    state.activeSlideIndex = 0;
    state.totalSlidesCount = data.design.slides.length;
    
    // Toggle Carousel Controls visibility
    const controls = document.getElementById('carousel-controls');
    if (state.totalSlidesCount > 1) {
      controls.classList.remove('hidden');
      document.getElementById('carousel-slide-indicator').textContent = `Slide 1 of ${state.totalSlidesCount}`;
    } else {
      controls.classList.add('hidden');
    }

    const firstSlide = data.design.slides[0];
    await drawDesignOnCanvas(data.design, firstSlide.userAssetFile || firstSlide.userAssetUrl);
    
    hideLoader();
    const model = data.design?.generation?.realImageGeneration?.model || 'Gemini image model';
    const quality = data.design?.generation?.templateRuleQuality;
    if (generationEvidencePill) {
      generationEvidencePill.classList.remove('muted');
      generationEvidencePill.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(model)} · ${state.totalSlidesCount} slide${state.totalSlidesCount === 1 ? '' : 's'} · ${quality?.score || 0}/8 rule checks`;
    }
    showToast(`Generated ${state.totalSlidesCount === 1 ? 'one design' : state.totalSlidesCount + ' slides'} via backend pipeline.`, 'success');
    loadHistory(); // Refresh history panel
    loadTemplates(); // Refresh user-scoped saved templates
    loadIntegrationStatus();
  } catch (err) {
    console.warn('Image generation request failed.');
    const message = err.name === 'AbortError'
      ? 'Image generation timed out. Please try again in a moment.'
      : (err.message || 'Please check server connections.');
    showToast(message, 'error');
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
// User-scoped Template Memory Panel
// ----------------------------------------------------

async function loadTemplates() {
  if (!state.token || !templateList) return;
  const requestId = ++state.templateLoadRequestId;
  try {
    const res = await fetch(`${API_URL}/api/templates`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (res.ok) {
      if (requestId !== state.templateLoadRequestId) return;
      state.templates = await res.json();
      renderTemplateList();
    }
  } catch (err) {
    console.error('Failed to load saved templates', err);
  }
}

function renderTemplateList() {
  if (!templateList) return;
  templateList.innerHTML = '';

  if (state.templates.length === 0) {
    templateList.innerHTML = `
      <div class="history-empty compact-empty">
        <i class="fa-regular fa-clone"></i>
        <p>No saved templates yet</p>
      </div>`;
    return;
  }

  state.templates.forEach(template => {
    const card = document.createElement('div');
    card.className = `history-card template-card ${state.selectedTemplateId === template.templateId ? 'active' : ''} ${state.templateLoadingId === template.templateId ? 'loading' : ''}`;

    const formattedDate = new Date(template.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = `
      <div class="history-header">
        <span class="history-type">${escapeHtml(template.designType || 'Template')}</span>
        <button type="button" class="template-delete-btn" title="Delete this template" aria-label="Delete template ${escapeHtml(template.templateId)}">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
      <div class="history-copy">${escapeHtml(template.summary || template.templateId)}</div>
      <div class="template-meta">${escapeHtml(template.templateId)} · ${escapeHtml(template.mode || 'single')} · ${state.templateLoadingId === template.templateId ? 'Loading…' : formattedDate}</div>
    `;

    card.addEventListener('click', () => selectTemplate(template.templateId));
    card.querySelector('.template-delete-btn').addEventListener('click', (event) => {
      event.stopPropagation();
      deleteTemplate(template.templateId);
    });

    templateList.appendChild(card);
  });
}

async function selectTemplate(templateId) {
  if (!templateId) return;
  state.selectedTemplateId = templateId;
  state.templateLoadingId = templateId;
  renderTemplateList();
  renderSelectedTemplateLoading(templateId);
  try {
    const res = await fetch(`${API_URL}/api/templates/${encodeURIComponent(templateId)}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Template fetch failed');
    if (state.templateLoadingId !== templateId) return;
    state.selectedTemplateId = data.template.templateId;
    state.selectedTemplate = data.template;
    renderSelectedTemplate();
    renderTemplateList();
    showToast('Template selected for generation.', 'success');
  } catch (err) {
    if (state.templateLoadingId === templateId) {
      state.selectedTemplateId = state.selectedTemplate?.templateId || null;
      renderSelectedTemplate();
      renderTemplateList();
    }
    showToast(`Could not load template: ${err.message}`, 'error');
  } finally {
    if (state.templateLoadingId === templateId) {
      state.templateLoadingId = null;
      renderTemplateList();
    }
  }
}

function renderSelectedTemplateLoading(templateId) {
  if (!selectedTemplateCard || !templateRuleViewer) return;
  selectedTemplateCard.classList.remove('muted');
  selectedTemplateCard.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Loading template ${escapeHtml(templateId)}…`;
  templateRuleViewer.classList.add('hidden');
  templateRuleViewer.innerHTML = '';
}

function renderSelectedTemplate() {
  if (!selectedTemplateCard || !templateRuleViewer) return;
  const template = state.selectedTemplate;
  if (!template) {
    selectedTemplateCard.classList.add('muted');
    selectedTemplateCard.textContent = 'No template selected. Create one from a reference image or select an existing template from the sidebar.';
    templateRuleViewer.classList.add('hidden');
    templateRuleViewer.innerHTML = '';
    return;
  }

  selectedTemplateCard.classList.remove('muted');
  selectedTemplateCard.innerHTML = `
    <strong>${escapeHtml(template.designType || 'Template Rule')}</strong><br>
    <span>${escapeHtml(template.templateId)}</span> · <span>${escapeHtml(template.mode || 'single')}</span>
  `;
  templateRuleViewer.classList.remove('hidden');
  templateRuleViewer.innerHTML = markdownToHtml(template.ruleText || '');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  let html = '';
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      closeList();
      const level = Math.min((line.match(/^#+/) || [''])[0].length, 4);
      html += `<h${level}>${escapeHtml(line.replace(/^#{1,4}\s+/, ''))}</h${level}>`;
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`;
    } else if (/^\|.+\|$/.test(line)) {
      closeList();
      const cells = line.split('|').slice(1, -1).map(cell => `<td>${escapeHtml(cell.trim())}</td>`).join('');
      html += `<table><tr>${cells}</tr></table>`;
    } else {
      closeList();
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  closeList();
  return html || '<p>No rule text available.</p>';
}

async function deleteTemplate(templateId) {
  if (!templateId) return;
  const ok = window.confirm('Delete this saved template? Existing generated designs will stay in your history.');
  if (!ok) return;

  try {
    const res = await fetch(`${API_URL}/api/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Delete failed');

    state.templates = state.templates.filter(template => template.templateId !== templateId);
    if (state.selectedTemplateId === templateId) {
      state.selectedTemplateId = null;
      state.selectedTemplate = null;
      state.templateLoadingId = null;
      renderSelectedTemplate();
    }
    renderTemplateList();
    await loadTemplates();
    showToast('Template deleted.', 'success');
  } catch (err) {
    showToast(`Could not delete template: ${err.message}`, 'error');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ----------------------------------------------------
// AI Image Preview Renderer
// ----------------------------------------------------

async function drawDesignOnCanvas(design) {
  const slide = design.slides ? design.slides[state.activeSlideIndex] : design;
  if (!slide?.generatedImageUrl) {
    throw new Error('The generated image is not ready yet. Please try again.');
  }

  const generated = await loadImage(slide.generatedImageUrl);
  renderCanvas.width = generated.naturalWidth || generated.width || 1280;
  renderCanvas.height = generated.naturalHeight || generated.height || 720;
  ctx.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
  ctx.drawImage(generated, 0, 0, renderCanvas.width, renderCanvas.height);
  downloadBtn.removeAttribute('disabled');
}

// Canvas Utility Functions
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = resolveReachableUrl(src);
  });
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
  state.activeSlideIndex = 0;
  state.totalSlidesCount = design.slides ? design.slides.length : 1;

  // Toggle Carousel Controls visibility
  const controls = document.getElementById('carousel-controls');
  if (state.totalSlidesCount > 1) {
    controls.classList.remove('hidden');
    document.getElementById('carousel-slide-indicator').textContent = `Slide 1 of ${state.totalSlidesCount}`;
  } else {
    controls.classList.add('hidden');
  }

  // Update configuration form values
  if (design.slides) {
    document.getElementById('headline-input').value = design.slides.map(s => s.userCopyText).join(' | ');
  } else {
    document.getElementById('headline-input').value = design.userCopyText;
  }
  
  const modeRadio = document.querySelector(`input[name="generationMode"][value="${design.mode === 'carousel' ? 'carousel' : 'single'}"]`);
  if (modeRadio) { modeRadio.checked = true; updateGenerationModeSelection(); }

  // Set active design type radio button
  const radios = document.getElementsByName('designType');
  radios.forEach(radio => {
    if (radio.value === design.designType) {
      radio.checked = true;
      updateDesignTypeSelection();
    }
  });

  // Re-draw design with default asset avatar clip
  const slideToDraw = design.slides ? design.slides[0] : design;
  drawDesignOnCanvas(design, slideToDraw.userAssetFile || slideToDraw.userAssetUrl);
}

// ----------------------------------------------------
// Carousel Slide Navigation Helper
// ----------------------------------------------------
function navigateSlide(direction) {
  if (!state.currentDesign || !state.currentDesign.slides) return;
  
  state.activeSlideIndex = (state.activeSlideIndex + direction + state.totalSlidesCount) % state.totalSlidesCount;
  
  // Update UI indicator
  document.getElementById('carousel-slide-indicator').textContent = `Slide ${state.activeSlideIndex + 1} of ${state.totalSlidesCount}`;
  
  const activeSlide = state.currentDesign.slides[state.activeSlideIndex];
  drawDesignOnCanvas(state.currentDesign, activeSlide.userAssetFile || activeSlide.userAssetUrl);
}


// ----------------------------------------------------
// Production UI Feedback, Drag & Drop, Integration Status
// ----------------------------------------------------
function ensureUiFeedbackElements() {
  if (!document.getElementById('toast-region')) {
    const toast = document.createElement('div');
    toast.id = 'toast-region';
    toast.className = 'toast-region';
    document.body.appendChild(toast);
  }

  if (!document.getElementById('integration-status-panel')) {
    const panel = document.createElement('div');
    panel.id = 'integration-status-panel';
    panel.className = 'integration-status-panel';
    panel.innerHTML = '<span class="status-pill muted">Checking integrations…</span>';
    const header = document.querySelector('.workspace-header');
    if (header) header.appendChild(panel);
  }
}

function showToast(message, type = 'info') {
  ensureUiFeedbackElements();
  const region = document.getElementById('toast-region');
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = message;
  region.appendChild(item);
  setTimeout(() => item.remove(), 6000);
}

function setupFileDropZones() {
  [
    { type: 'ref', zoneId: 'ref-file-container', inputId: 'ref-file-input' },
    { type: 'asset', zoneId: 'asset-file-container', inputId: 'asset-file-input' }
  ].forEach(({ type, zoneId, inputId }) => {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input || zone.dataset.dropReady === 'true') return;
    zone.dataset.dropReady = 'true';

    ['dragenter', 'dragover'].forEach(eventName => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove('drag-over');
      });
    });

    zone.addEventListener('drop', (event) => {
      const files = Array.from(event.dataTransfer.files || []).filter(file => file.type.startsWith('image/'));
      if (!files.length) {
        showToast('Drop image files only.', 'error');
        return;
      }
      const dt = new DataTransfer();
      files.forEach(file => dt.items.add(file));
      input.files = dt.files;
      handleFileSelected(type, input);
      showToast(`${files.length} ${type === 'ref' ? 'reference' : 'asset'} image(s) added.`, 'success');
    });
  });
}

async function loadIntegrationStatus() {
  if (!state.token) return;
  ensureUiFeedbackElements();
  const panel = document.getElementById('integration-status-panel');
  try {
    const res = await fetch(`${API_URL}/api/integrations/status`, {
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'X-Public-N8n-Url': SERVICE_URLS.n8n,
        'X-Public-Flowise-Url': SERVICE_URLS.flowise
      }
    });
    if (!res.ok) throw new Error('status unavailable');
    const data = await res.json();
    const entries = Object.values(data).map(item => {
      const ok = Boolean(item.ok);
      const publicUrl = item.publicUrl ? ` data-url="${escapeHtml(item.publicUrl)}" title="${escapeHtml(item.publicUrl)}"` : '';
      const label = ok ? 'ready' : 'offline';
      return `<span class="status-pill ${ok ? 'ok' : 'warn'}"${publicUrl}>${item.name}: ${label}</span>`;
    }).join('');
    panel.innerHTML = entries;
  } catch (error) {
    panel.innerHTML = '<span class="status-pill warn">integration status unavailable</span>';
  }
}
