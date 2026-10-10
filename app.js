const authScreen = document.querySelector("#authScreen");
const appShell = document.querySelector("#appShell");
const authForm = document.querySelector("#authForm");
const authUsernameField = document.querySelector("#authUsernameField");
const authEmailField = document.querySelector("#authEmailField");
const authIdentifierField = document.querySelector("#authIdentifierField");
const authTitle = document.querySelector("#authTitle");
const authSubtitle = document.querySelector("#authSubtitle");
const authSubmit = document.querySelector("#authSubmit");
const authSwitch = document.querySelector("#authSwitch");
const authSwitchPrompt = document.querySelector("#authSwitchPrompt");
const authError = document.querySelector("#authError");
let authMode = "login";
const useApiAuth = window.location.protocol !== "file:";
const AUTH_USERS_KEY = "liqin-users";
const AUTH_SESSION_KEY = "liqin-session";

function createId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getAuthUsers() {
  return JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || "[]");
}
function getSignedInUser() {
  const session = JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY) || "null");
  return session && getAuthUsers().find(user => user.id === session.userId);
}
async function apiRequest(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "The request could not be completed.");
  }
  return response.status === 204 ? null : response.json();
}
function setAuthError(message) {
  authError.textContent = message;
  authError.hidden = !message;
}
async function hashPassword(password) {
  const encoded = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function updateAuthMode() {
  const registering = authMode === "register";
  authTitle.innerHTML = `${registering ? "Create your account" : "Welcome back"}<span class="accent-dot">.</span>`;
  authSubtitle.textContent = registering ? "Set up your private liquor inventory workspace." : "Sign in to manage your liquor inventory.";
  authUsernameField.hidden = !registering;
  authEmailField.hidden = !registering;
  authUsernameField.querySelector("input").required = registering;
  authEmailField.querySelector("input").required = registering;
  authIdentifierField.hidden = registering;
  authForm.elements.identifier.required = !registering;
  authForm.elements.password.autocomplete = registering ? "new-password" : "current-password";
  authSubmit.innerHTML = `${registering ? "Create account" : "Sign in"} <span>→</span>`;
  authSwitchPrompt.textContent = registering ? "Already have an account?" : "Don't have an account?";
  authSwitch.textContent = registering ? "Sign in" : "Create one";
  setAuthError("");
}
function showAuthenticatedApp(user) {
  authScreen.hidden = true;
  appShell.hidden = false;
  const displayName = user.username || user.name;
  const initials = displayName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
  document.querySelector("#profileName").textContent = displayName;
  document.querySelector("#profileAvatar").textContent = initials;
  document.querySelector("#topAvatar").textContent = initials;
}
function showAuthScreen() {
  authScreen.hidden = false;
  appShell.hidden = true;
  updateAuthMode();
}
async function authenticateLocalUser(identifier, password) {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const user = getAuthUsers().find(candidate => candidate.email === normalizedIdentifier || candidate.username?.toLowerCase() === normalizedIdentifier || candidate.name?.toLowerCase() === normalizedIdentifier);
  if (!user || user.passwordHash !== await hashPassword(password)) throw new Error("The username/email or password is incorrect.");
  return user;
}
authSwitch.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  authForm.reset();
  updateAuthMode();
});
authForm.addEventListener("submit", async event => {
  event.preventDefault();
  setAuthError("");
  const data = new FormData(authForm);
  const email = data.get("email")?.trim().toLowerCase();
  const username = data.get("username")?.trim();
  const identifier = data.get("identifier")?.trim();
  const password = data.get("password");
  try {
    let user;
    if (useApiAuth) {
      const result = authMode === "register"
        ? await apiRequest("/api/auth/register", { method: "POST", body: JSON.stringify({ username, email, password }) })
        : await apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) });
      showAuthenticatedApp(result.user);
      await loadApiInventory();
      authForm.reset();
      return;
    }
    if (authMode === "register") {
      const users = getAuthUsers();
      const normalizedUsername = username.toLowerCase();
      if (users.some(candidate => candidate.email === email)) throw new Error("An account with this email already exists.");
      if (users.some(candidate => candidate.username?.toLowerCase() === normalizedUsername)) throw new Error("That username is already in use.");
      user = { id: createId(), username, email, name: username, passwordHash: await hashPassword(password) };
      users.push(user);
      localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
    } else {
      user = await authenticateLocalUser(identifier, password);
    }
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ userId: user.id }));
    showAuthenticatedApp(user);
    authForm.reset();
  } catch (error) {
    setAuthError(error.message);
  }
});
document.querySelector("#logoutButton").addEventListener("click", async () => {
  if (useApiAuth) await apiRequest("/api/auth/logout", { method: "POST" });
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  showAuthScreen();
  authForm.elements.identifier.focus();
});

const starterItems = [];
const starterGroups = {};
const typeLabels = { text: "Text", barcode: "Barcode", year: "Year", date: "Date", currency: "Currency", decimal: "Decimal", single: "Single option", multiple: "Multiple options" };
const currencyOptions = ["USD", "EUR", "GBP", "IDR", "JPY", "AUD", "CAD", "CHF", "CNY", "SGD"];
const fallbackImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='480' viewBox='0 0 480 480'%3E%3Crect width='480' height='480' fill='%23eef0ed'/%3E%3C/svg%3E";
let items = (JSON.parse(localStorage.getItem("liqin-items") || "[]")).map(item => ({ ...item, id: item.id || createId(), thumbnail: item.thumbnail || item.image || fallbackImage }));
let fieldDefinitions = JSON.parse(localStorage.getItem("liqin-groups") || "{}");
Object.keys(fieldDefinitions).forEach(group => {
  fieldDefinitions[group] = (fieldDefinitions[group] || []).map(field => ({ ...field, showInDashboard: field.showInDashboard === true }));
});
Object.values(fieldDefinitions).forEach(fields => fields.forEach(field => {
  if (field.type === "integer") {
    field.type = "decimal";
    field.precision = 0;
  }
  if (field.type === "currency") field.precision = 2;
}));
let selectedGroup = "All";
let editingItemId = null;
let editingGroupName = null;
let pendingPhoto = null;
let selectedPhotoFile = null;
let photoSelectionToken = 0;
let currentView = "grid";
let draggedBuilderRow = null;
const filters = { group: "All", stock: "all", photo: "all", sort: "recent" };
const grid = document.querySelector("#inventoryGrid");
const groupSelect = document.querySelector("#groupSelect");
const customFields = document.querySelector("#customFields");
const modal = document.querySelector("#itemModal");
const barcodeModal = document.querySelector("#barcodeModal");
const groupModal = document.querySelector("#groupModal");
const detailModal = document.querySelector("#detailModal");
const settingsModal = document.querySelector("#settingsModal");
const createGroupModal = document.querySelector("#createGroupModal");

document.addEventListener("pointermove", event => {
  if (!draggedBuilderRow) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".builder-row");
  if (!target || target === draggedBuilderRow || !target.parentElement?.matches("#fieldBuilder")) return;
  document.querySelectorAll(".builder-row.drag-over").forEach(row => row.classList.remove("drag-over"));
  target.classList.add("drag-over");
  const midpoint = target.getBoundingClientRect().top + target.offsetHeight / 2;
  target.parentElement.insertBefore(draggedBuilderRow, event.clientY < midpoint ? target : target.nextElementSibling);
});
document.addEventListener("pointerup", () => {
  if (!draggedBuilderRow) return;
  draggedBuilderRow.classList.remove("dragging");
  document.querySelectorAll(".builder-row.drag-over").forEach(row => row.classList.remove("drag-over"));
  draggedBuilderRow = null;
});

function persist() {
  localStorage.setItem("liqin-items", JSON.stringify(items));
  localStorage.setItem("liqin-groups", JSON.stringify(fieldDefinitions));
}
async function loadApiInventory() {
  const data = await apiRequest("/api/inventory");
  fieldDefinitions = Object.fromEntries(data.groups.map(group => [group.name, (group.fields || []).map(field => ({ ...field, showInDashboard: field.showInDashboard === true }))]));
  items = (data.items || []).map(item => ({ ...item, detail: `${item.quantity} in stock`, price: "—", thumbnail: item.thumbnailUrl || fallbackImage, image: item.imageUrl || fallbackImage, originalImage: item.imageUrl || undefined }));
  selectedGroup = "All";
  renderGroupControls();
  renderItems();
  renderCustomFields();
}
function groupPayload(name, fields) {
  return { name, fields: fields.map(field => ({ label: field.label, name: field.name, type: field.type, options: field.options || [], precision: field.precision, showInDashboard: field.showInDashboard === true, placeholder: field.placeholder })) };
}
function groupNames() { return Object.keys(fieldDefinitions); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character])); }
function formatFieldValue(field, value) {
  if (field.type === "currency" && value && typeof value === "object") return `${value.currency || "USD"} ${Number(value.amount || 0).toFixed(2)}`;
  return Array.isArray(value) ? value.join(", ") : value;
}
function renderDashboardFields(item) {
  return (fieldDefinitions[item.group] || []).filter(field => field.showInDashboard && item.values?.[field.name] !== undefined && item.values[field.name] !== "").map(field => {
    const value = formatFieldValue(field, item.values[field.name]);
    return `<span class="dashboard-field"><small>${escapeHtml(field.label)}</small><strong>${escapeHtml(value)}</strong></span>`;
  }).join("");
}
function renderItems() {
  const query = document.querySelector("#searchInput").value.toLowerCase();
  let visible = items.filter(item => {
    const quantity = Number(item.quantity || 0);
    const hasPhoto = Boolean(item.thumbnail || item.image || item.originalImage);
    return (selectedGroup === "All" || item.group === selectedGroup) &&
      (filters.group === "All" || item.group === filters.group) &&
      (filters.stock === "all" || (filters.stock === "in" && quantity > 0) || (filters.stock === "low" && quantity > 0 && quantity <= 2)) &&
      (filters.photo === "all" || (filters.photo === "with" && hasPhoto) || (filters.photo === "without" && !hasPhoto)) &&
      `${item.name} ${item.group}`.toLowerCase().includes(query);
  });
  visible.sort((a, b) => {
    if (filters.sort === "name") return a.name.localeCompare(b.name);
    if (filters.sort === "group") return a.group.localeCompare(b.group) || a.name.localeCompare(b.name);
    if (filters.sort === "quantity") return Number(b.quantity || 0) - Number(a.quantity || 0);
    return items.indexOf(a) - items.indexOf(b);
  });
  grid.classList.toggle("list-view", currentView === "list");
  grid.innerHTML = visible.length ? visible.map(item => `<article class="item-card" data-item-id="${item.id}"><button class="item-card-button" type="button" aria-label="Open ${escapeHtml(item.name)}"><div class="bottle-image"><img src="${escapeHtml(item.thumbnail || item.image)}" alt="${escapeHtml(item.name)}" loading="lazy"><span class="item-group">${escapeHtml(item.group)}</span></div><div class="card-body"><h3>${escapeHtml(item.name)}</h3><div class="card-meta"><span>${escapeHtml(item.detail)}</span><strong>${escapeHtml(item.price)}</strong></div>${renderDashboardFields(item) ? `<div class="dashboard-fields">${renderDashboardFields(item)}</div>` : ""}</div></button></article>`).join("") : '<div class="empty-state">No items found in this view.</div>';
  document.querySelector("#itemTotalLabel").textContent = visible.length;
  document.querySelector("#totalItems").textContent = items.length;
}
function renderGroupControls() {
  const names = groupNames();
  groupSelect.innerHTML = names.map(name => `<option>${escapeHtml(name)}</option>`).join("");
  document.querySelector("#filterGroup").innerHTML = `<option value="All">All groups</option>${names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  document.querySelector("#filterGroup").value = filters.group;
  document.querySelector("#groupCount").textContent = names.length;
  document.querySelector("#groupsTotal").textContent = names.length;
  document.querySelector("#groupTabs").innerHTML = [`<button class="tab active" data-group="All">All <span>${items.length}</span></button>`, ...names.map(name => `<button class="tab" data-group="${escapeHtml(name)}">${escapeHtml(name)} <span>${items.filter(item => item.group === name).length}</span></button>`)].join("");
}
function renderCustomFields() {
  const fields = fieldDefinitions[groupSelect.value] || [];
  customFields.innerHTML = fields.map(field => {
    const inputType = field.type === "year" || field.type === "decimal" || field.type === "currency" ? "number" : field.type === "date" ? "date" : "text";
    const precision = field.type === "currency" ? 2 : Number.isInteger(field.precision) ? field.precision : 2;
    const step = precision === 0 ? "1" : `0.${"0".repeat(Math.max(0, precision - 1))}1`;
    const numericAttributes = field.type === "decimal" || field.type === "currency" ? `step="${step}" min="0"` : field.type === "year" ? 'min="1000" max="9999"' : "";
    if (field.type === "single") return `<label class="field"><span>${escapeHtml(field.label)}</span><select name="${escapeHtml(field.name)}">${(field.options || []).map(option => `<option>${escapeHtml(option)}</option>`).join("")}</select></label>`;
    if (field.type === "multiple") return `<fieldset class="field option-field"><legend>${escapeHtml(field.label)}</legend><div class="multi-options">${(field.options || []).map(option => `<label><input type="checkbox" name="${escapeHtml(field.name)}" value="${escapeHtml(option)}"><span>${escapeHtml(option)}</span></label>`).join("")}</div></fieldset>`;
    if (field.type === "currency") return `<div class="field"><span>${escapeHtml(field.label)}</span><div class="currency-input"><select name="${escapeHtml(field.name)}__currency" aria-label="${escapeHtml(field.label)} currency">${currencyOptions.map(currency => `<option>${currency}</option>`).join("")}</select><input name="${escapeHtml(field.name)}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"></div></div>`;
    if (field.type === "barcode") return `<div class="field"><span>${escapeHtml(field.label)}</span><div class="barcode-input"><input name="${escapeHtml(field.name)}" type="text" inputmode="numeric" autocomplete="off" placeholder="${escapeHtml(field.placeholder || "Scan or enter barcode")}"><button type="button" class="secondary-button scan-barcode" data-field-name="${escapeHtml(field.name)}">Scan</button></div></div>`;
    return `<label class="field"><span>${escapeHtml(field.label)}</span><input name="${escapeHtml(field.name)}" type="${inputType}" inputmode="${inputType === "number" ? "decimal" : ""}" placeholder="${escapeHtml(field.placeholder || "")}" ${numericAttributes}></label>`;
  }).join("");
}
function fillCustomFields(values = {}) {
  customFields.querySelectorAll("[name]").forEach(input => {
    const value = values[input.name];
    if (input.type === "checkbox") input.checked = Array.isArray(value) && value.includes(input.value);
    else if (value && typeof value === "object" && !Array.isArray(value)) input.value = value[input.name.endsWith("__currency") ? "currency" : "amount"] || "";
    else input.value = Array.isArray(value) ? value.join(", ") : value || "";
  });
  Object.entries(values).forEach(([name, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const currency = customFields.querySelector(`[name="${CSS.escape(name)}__currency"]`);
      if (currency) currency.value = value.currency || "USD";
    }
  });
}
function openModal(target) { target.hidden = false; document.body.style.overflow = "hidden"; }
let barcodeStream = null;
let barcodeAnimationFrame = null;
let barcodeFieldName = null;
let barcodeDetector = null;
let barcodeLastValue = "";
let barcodeConsecutiveReads = 0;
function stopBarcodeScanner() {
  if (barcodeAnimationFrame) cancelAnimationFrame(barcodeAnimationFrame);
  barcodeAnimationFrame = null;
  if (barcodeStream) barcodeStream.getTracks().forEach(track => track.stop());
  barcodeStream = null;
  barcodeDetector = null;
  barcodeLastValue = "";
  barcodeConsecutiveReads = 0;
  document.querySelector("#barcodeVideo").srcObject = null;
}
function closeModal(target) {
  target.hidden = true;
  if (target === barcodeModal) stopBarcodeScanner();
  if (modal.hidden && detailModal.hidden && groupModal.hidden && createGroupModal.hidden && settingsModal.hidden && barcodeModal.hidden) document.body.style.overflow = "";
}
function hasValidBarcodeChecksum(value, format) {
  if (!/^\d+$/.test(value)) return format === "qr_code" || format === "code_128";
  if (format === "ean_13" && value.length === 13 || format === "ean_8" && value.length === 8 || format === "upc_a" && value.length === 12) {
    const digits = [...value].map(Number);
    const check = digits.pop();
    const sum = digits.reduce((total, digit, index) => total + digit * ((digits.length - index) % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }
  return format === "upc_e" ? value.length === 6 || value.length === 8 : format === "qr_code" || format === "code_128";
}
async function startBarcodeScanner(fieldName) {
  barcodeFieldName = fieldName;
  openModal(barcodeModal);
  const message = document.querySelector("#barcodeMessage");
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    message.textContent = "Camera scanning is not supported here. Enter the barcode manually.";
    return;
  }
  try {
    barcodeDetector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
    const video = document.querySelector("#barcodeVideo");
    await switchBarcodeCamera("");
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameraSelect = document.querySelector("#barcodeCameraSelect");
    cameraSelect.innerHTML = `<option value="">Default camera</option>${devices.filter(device => device.kind === "videoinput").map((device, index) => `<option value="${escapeHtml(device.deviceId)}">${escapeHtml(device.label || `Camera ${index + 1}`)}</option>`).join("")}`;
    const activeDeviceId = barcodeStream?.getVideoTracks()[0]?.getSettings().deviceId;
    if (activeDeviceId) cameraSelect.value = activeDeviceId;
    const scan = async () => {
      if (barcodeModal.hidden) return;
      try {
        const results = await barcodeDetector.detect(video);
        const result = results.find(candidate => candidate.rawValue);
        const value = result?.rawValue?.trim() || "";
        const valid = value && hasValidBarcodeChecksum(value, result.format);
        if (valid && value === barcodeLastValue) barcodeConsecutiveReads += 1;
        else if (valid) {
          barcodeLastValue = value;
          barcodeConsecutiveReads = 1;
        } else {
          barcodeLastValue = "";
          barcodeConsecutiveReads = 0;
        }
        if (valid && barcodeConsecutiveReads >= 3) {
          const input = customFields.querySelector(`[name="${CSS.escape(barcodeFieldName)}"]`);
          if (input) input.value = value;
          closeModal(barcodeModal);
          return;
        }
        message.textContent = valid ? "Barcode detected. Hold steady..." : "Point the camera at a barcode and hold it steady.";
      } catch {
        message.textContent = "Unable to read that barcode. Try moving closer or enter it manually.";
      }
      barcodeAnimationFrame = requestAnimationFrame(scan);
    };
    barcodeAnimationFrame = requestAnimationFrame(scan);
  } catch {
    message.textContent = "Camera access was unavailable. Enter the barcode manually.";
    stopBarcodeScanner();
  }
}
async function switchBarcodeCamera(deviceId) {
  if (barcodeStream) barcodeStream.getTracks().forEach(track => track.stop());
  const constraints = {
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: "continuous" }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: "continuous" },
    audio: false
  };
  barcodeStream = await navigator.mediaDevices.getUserMedia(constraints);
  const video = document.querySelector("#barcodeVideo");
  video.srcObject = barcodeStream;
  await video.play();
  const track = barcodeStream.getVideoTracks()[0];
  const capabilities = track.getCapabilities?.();
  const advanced = [];
  if (capabilities?.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
  if (capabilities?.zoom) advanced.push({ zoom: Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min, 1.5)) });
  if (advanced.length) await track.applyConstraints({ advanced }).catch(() => {});
  barcodeLastValue = "";
  barcodeConsecutiveReads = 0;
}
function resetPhotoPreview() {
  photoSelectionToken += 1;
  const photoInput = document.querySelector("#photoInput");
  const cameraInput = document.querySelector("#cameraInput");
  const previewImage = document.querySelector("#photoPreview img");
  if (previewImage.src.startsWith("blob:")) URL.revokeObjectURL(previewImage.src);
  photoInput.value = "";
  cameraInput.value = "";
  previewImage.removeAttribute("src");
  document.querySelector("#photoPreview").hidden = true;
  pendingPhoto = null;
  selectedPhotoFile = null;
}
function openItemEditor(item = null) {
  editingItemId = item ? item.id : null;
  document.querySelector("#itemModalEyebrow").textContent = item ? "Update collection" : "New addition";
  document.querySelector("#modalTitle").innerHTML = `${item ? "Edit an item" : "Add an item"}<span class="accent-dot">.</span>`;
  document.querySelector("#itemSubmitButton").innerHTML = `${item ? "Save changes" : "Add to collection"} <span>→</span>`;
  const form = document.querySelector("#itemForm");
  form.reset();
  resetPhotoPreview();
  if (item) {
    form.elements.name.value = item.name;
    form.elements.group.value = item.group;
    form.elements.quantity.value = item.quantity || 1;
  }
  renderCustomFields();
  fillCustomFields(item?.values);
  if (item && (item.thumbnail || item.image)) {
    const previewImage = document.querySelector("#photoPreview img");
    previewImage.src = item.thumbnail || item.image;
    document.querySelector("#photoPreview").hidden = false;
  }
  openModal(modal);
}
function renderDetail(item) {
  const fields = fieldDefinitions[item.group] || [];
  const details = fields.map(field => {
    const value = item.values?.[field.name];
    if (!value) return "";
    return `<div class="detail-field"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(formatFieldValue(field, value))}</strong></div>`;
  }).join("");
  document.querySelector("#detailContent").innerHTML = `<p class="eyebrow">${escapeHtml(item.group)}</p><h2 id="detailTitle">${escapeHtml(item.name)}<span class="accent-dot">.</span></h2><p class="detail-subtitle">${escapeHtml(item.detail)} · ${escapeHtml(item.price)}</p><img class="detail-image" src="${escapeHtml(item.originalImage || item.image)}" alt="${escapeHtml(item.name)}"><div class="detail-fields">${details || '<p class="detail-empty">No custom values recorded for this item.</p>'}</div><div class="modal-actions"><button type="button" class="secondary-button" id="deleteItemButton">Delete item</button><button type="button" class="primary-button" id="editItemButton">Edit item <span>→</span></button></div>`;
  document.querySelector("#editItemButton").addEventListener("click", () => { closeModal(detailModal); openItemEditor(item); });
  document.querySelector("#deleteItemButton").addEventListener("click", async () => {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    if (useApiAuth) await apiRequest(`/api/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    items = items.filter(candidate => candidate.id !== item.id);
    persist(); closeModal(detailModal); renderGroupControls(); renderItems();
  });
}
function createThumbnail(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Unable to process the selected image."));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 480 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ originalImage: reader.result, thumbnail: canvas.toDataURL("image/jpeg", 0.78) });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function refreshBuilderOptions(row) {
  const optionEditor = row.querySelector(".option-editor");
  const precisionEditor = row.querySelector(".precision-editor");
  const type = row.querySelector('[name="fieldType"]').value;
  optionEditor.hidden = type !== "single" && type !== "multiple";
  precisionEditor.hidden = type !== "decimal";
  row.querySelector('[name="precision"]').disabled = type !== "decimal";
}
function addOption(row, value = "") {
  const options = row.querySelector(".option-chips");
  const input = row.querySelector('[name="optionInput"]');
  const option = (value || input.value).trim();
  if (!option || [...options.querySelectorAll("input")].some(existing => existing.value.toLowerCase() === option.toLowerCase())) return;
  const chip = document.createElement("label");
  chip.className = "option-chip";
  chip.innerHTML = `<input type="hidden" name="optionValue" value="${escapeHtml(option)}"><span>${escapeHtml(option)}</span><button type="button" aria-label="Remove ${escapeHtml(option)}">×</button>`;
  chip.querySelector("button").addEventListener("click", () => chip.remove());
  options.append(chip);
  input.value = "";
}
function addBuilderRow(field = {}) {
  const row = document.createElement("div");
  row.className = "builder-row";
  row.draggable = false;
  row.innerHTML = `<div class="builder-main"><span class="drag-handle" title="Drag to reorder" aria-label="Drag to reorder">⠿</span><label class="dashboard-toggle" title="Show this field on the dashboard"><input name="showInDashboard" type="checkbox" aria-label="Show ${escapeHtml(field.label || "field")} on the dashboard" ${field.showInDashboard === true ? "checked" : ""}></label><input name="fieldLabel" required placeholder="Field name" value="${escapeHtml(field.label || "")}"><select name="fieldType">${Object.entries(typeLabels).map(([value, label]) => `<option value="${value}" ${field.type === value ? "selected" : ""}>${label}</option>`).join("")}</select><div class="builder-actions"><button type="button" class="remove-field" aria-label="Remove field" title="Remove field">×</button></div></div><div class="precision-editor" hidden><label>Decimal places <input name="precision" type="number" min="0" max="8" value="${field.type === "currency" ? 2 : Number.isInteger(field.precision) ? field.precision : 2}"></label></div><div class="option-editor" hidden><div class="option-chips"></div><div class="option-add"><input name="optionInput" placeholder="Add an option"><button type="button" class="add-option">＋</button></div></div>`;
  row.querySelector(".remove-field").addEventListener("click", () => row.remove());
  row.querySelector(".drag-handle").addEventListener("pointerdown", event => {
    event.preventDefault();
    draggedBuilderRow = row;
    row.classList.add("dragging");
  });
  row.addEventListener("dragstart", event => {
    if (event.target.closest("input, select, button")) {
      event.preventDefault();
      return;
    }
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "field");
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("dragging");
    document.querySelectorAll(".builder-row.drag-over").forEach(candidate => candidate.classList.remove("drag-over"));
  });
  row.addEventListener("dragover", event => {
    event.preventDefault();
    const dragging = document.querySelector(".builder-row.dragging");
    if (!dragging || dragging === row) return;
    row.classList.add("drag-over");
    const midpoint = row.getBoundingClientRect().top + row.offsetHeight / 2;
    row.parentElement.insertBefore(dragging, event.clientY < midpoint ? row : row.nextElementSibling);
  });
  row.addEventListener("dragleave", event => {
    if (!row.contains(event.relatedTarget)) row.classList.remove("drag-over");
  });
  row.querySelector('[name="fieldType"]').addEventListener("change", () => refreshBuilderOptions(row));
  row.querySelector(".add-option").addEventListener("click", () => addOption(row));
  row.querySelector('[name="optionInput"]').addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); addOption(row); } });
  (field.options || []).forEach(option => addOption(row, option));
  refreshBuilderOptions(row);
  document.querySelector("#fieldBuilder").append(row);
}
function renderGroupList() {
  const list = document.querySelector("#groupList");
  list.innerHTML = groupNames().map(name => {
    const count = items.filter(item => item.group === name).length;
    return `<div class="group-list-row"><div><strong>${escapeHtml(name)}</strong><small>${count} ${count === 1 ? "item" : "items"} · ${(fieldDefinitions[name] || []).length} custom fields</small></div><div class="group-row-actions"><button type="button" class="edit-group" data-group="${escapeHtml(name)}">Edit</button><button type="button" class="delete-group" data-group="${escapeHtml(name)}" ${count ? "disabled title=\"Remove items from this group before deleting\"" : ""}>Delete</button></div></div>`;
  }).join("");
}
function openGroupManager() {
  editingGroupName = null;
  renderGroupList();
  openModal(groupModal);
}
function openCreateGroup() {
  editingGroupName = null;
  document.querySelector("#groupForm").reset();
  document.querySelector("#createGroupTitle").innerHTML = 'Create a group<span class="accent-dot">.</span>';
  document.querySelector("#groupSubmitButton").innerHTML = 'Create group <span>→</span>';
  document.querySelector("#fieldBuilderTitle").textContent = "Custom fields";
  document.querySelector("#fieldBuilder").replaceChildren();
  addBuilderRow();
  closeModal(groupModal);
  openModal(createGroupModal);
  document.querySelector('[name="groupName"]').focus();
}
document.querySelector("#addItemButton").addEventListener("click", () => { openItemEditor(); document.querySelector('[name="name"]').focus(); });
document.querySelector("#closeModal").addEventListener("click", () => closeModal(modal));
document.querySelector("#cancelModal").addEventListener("click", () => closeModal(modal));
document.querySelector("#manageGroupsLink").addEventListener("click", event => { event.preventDefault(); openGroupManager(); });
document.querySelector("#closeGroupModal").addEventListener("click", () => closeModal(groupModal));
document.querySelector("#addGroupButton").addEventListener("click", openCreateGroup);
document.querySelector("#closeCreateGroupModal").addEventListener("click", () => closeModal(createGroupModal));
document.querySelector("#cancelCreateGroupModal").addEventListener("click", () => closeModal(createGroupModal));
document.querySelector("#addFieldButton").addEventListener("click", addBuilderRow);
document.querySelector("#groupList").addEventListener("click", async event => {
  const name = event.target.dataset.group;
  if (!name) return;
  if (event.target.classList.contains("edit-group")) {
    editingGroupName = name;
    document.querySelector("#groupForm").elements.groupName.value = name;
    document.querySelector("#groupModalTitle").innerHTML = 'Edit group<span class="accent-dot">.</span>';
    document.querySelector("#groupSubmitButton").innerHTML = 'Save changes <span>→</span>';
    document.querySelector("#fieldBuilderTitle").textContent = `Fields for ${name}`;
    document.querySelector("#fieldBuilder").replaceChildren();
    (fieldDefinitions[name] || []).forEach(field => addBuilderRow(field));
    if (!fieldDefinitions[name]?.length) addBuilderRow();
    closeModal(groupModal);
    openModal(createGroupModal);
    document.querySelector('[name="groupName"]').focus();
  } else if (event.target.classList.contains("delete-group")) {
    if (items.some(item => item.group === name)) return;
    if (!window.confirm(`Delete the ${name} group?`)) return;
    if (useApiAuth) await apiRequest(`/api/groups/${encodeURIComponent(name)}`, { method: "DELETE" });
    delete fieldDefinitions[name];
    persist();
    renderGroupControls();
    renderCustomFields();
    renderGroupList();
  }
});
document.querySelector(".mobile-menu").addEventListener("click", () => {
  document.querySelector(".app-shell").classList.toggle("sidebar-open");
});
document.querySelector(".sidebar-close").addEventListener("click", () => {
  document.querySelector(".app-shell").classList.remove("sidebar-open");
});
document.querySelector(".main-nav").addEventListener("click", () => {
  document.querySelector(".app-shell").classList.remove("sidebar-open");
});
document.querySelector(".main-content").addEventListener("click", event => {
  if (event.target.closest(".mobile-menu")) return;
  document.querySelector(".app-shell").classList.remove("sidebar-open");
});
[modal, detailModal, groupModal, createGroupModal, settingsModal, barcodeModal].forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) closeModal(dialog); }));
document.querySelector("#closeDetailModal").addEventListener("click", () => closeModal(detailModal));
document.querySelector("#closeBarcodeModal").addEventListener("click", () => closeModal(barcodeModal));
document.querySelector("#cancelBarcodeScan").addEventListener("click", () => closeModal(barcodeModal));
document.querySelector("#barcodeCameraSelect").addEventListener("change", async event => {
  try {
    await switchBarcodeCamera(event.target.value);
  } catch {
    document.querySelector("#barcodeMessage").textContent = "Unable to use that camera. Choose another camera or enter the barcode manually.";
  }
});
document.querySelector("#settingsLink").addEventListener("click", event => { event.preventDefault(); openModal(settingsModal); });
document.querySelector("#closeSettingsModal").addEventListener("click", () => closeModal(settingsModal));
document.querySelector("#passwordForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.querySelector("#passwordMessage");
  message.hidden = true;
  message.className = "password-message";
  const data = new FormData(event.target);
  const currentPassword = data.get("currentPassword");
  const newPassword = data.get("newPassword");
  try {
    if (useApiAuth) {
      await apiRequest("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword, confirmPassword: data.get("confirmPassword") }) });
      event.target.reset();
      message.textContent = "Password updated successfully.";
      message.classList.add("success");
      message.hidden = false;
      return;
    }
    const user = getSignedInUser();
    if (!user || user.passwordHash !== await hashPassword(currentPassword)) throw new Error("The current password is incorrect.");
    if (newPassword !== data.get("confirmPassword")) throw new Error("The new passwords do not match.");
    if (newPassword === currentPassword) throw new Error("The new password must be different.");
    const passwordHash = await hashPassword(newPassword);
    const users = getAuthUsers().map(candidate => candidate.id === user.id ? { ...candidate, passwordHash } : candidate);
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
    event.target.reset();
    message.textContent = "Password updated successfully.";
    message.classList.add("success");
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
  message.hidden = false;
});
document.querySelector("#exportDataButton").addEventListener("click", () => {
  const backup = { version: 1, exportedAt: new Date().toISOString(), items, groups: fieldDefinitions };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `liqin-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});
document.querySelector("#importDataInput").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.version !== 1 || !Array.isArray(backup.items) || !backup.groups || typeof backup.groups !== "object") throw new Error("This file is not a valid LiqIn backup.");
    if (!backup.items.every(item => item && typeof item.name === "string" && typeof item.group === "string")) throw new Error("The backup contains an invalid item.");
    if (useApiAuth) {
      const imported = await apiRequest("/api/inventory/import", { method: "POST", body: JSON.stringify(backup) });
      for (const importedItem of imported.items) {
        const source = backup.items[importedItem.sourceIndex];
        const imageData = source?.originalImage || source?.image;
        if (!imageData || !imageData.startsWith("data:image/")) continue;
        const imageResponse = await fetch(imageData);
        const imageBlob = await imageResponse.blob();
        const uploadData = new FormData();
        uploadData.append("image", imageBlob, "imported-image");
        const uploadResponse = await fetch(`/api/items/${encodeURIComponent(importedItem.id)}/image`, { method: "POST", credentials: "same-origin", body: uploadData });
        if (!uploadResponse.ok) throw new Error((await uploadResponse.json()).error || `Unable to import the image for ${source.name}.`);
      }
      await loadApiInventory();
      closeModal(settingsModal);
      return;
    }
    items = backup.items.map(item => ({ ...item, id: item.id || createId(), thumbnail: item.thumbnail || item.image || fallbackImage }));
    fieldDefinitions = backup.groups;
    Object.keys(fieldDefinitions).forEach(group => {
      fieldDefinitions[group] = (fieldDefinitions[group] || []).map(field => ({ ...field, showInDashboard: field.showInDashboard === true }));
    });
    persist();
    selectedGroup = "All";
    const signedInUser = getSignedInUser();
    if (useApiAuth) {
      apiRequest("/api/auth/me").then(async result => { showAuthenticatedApp(result.user); await loadApiInventory(); }).catch(() => showAuthScreen());
    } else if (signedInUser) showAuthenticatedApp(signedInUser);
    else showAuthScreen();
    renderGroupControls();
    renderItems();
    renderCustomFields();
    closeModal(settingsModal);
  } catch (error) {
    window.alert(`Import failed: ${error.message}`);
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#resetDataButton").addEventListener("click", async () => {
  if (!window.confirm("Delete all items and groups and leave this inventory empty?")) return;
  if (useApiAuth) {
    await apiRequest("/api/inventory", { method: "DELETE" });
    await loadApiInventory();
  } else {
    items = [];
    fieldDefinitions = {};
    persist();
    selectedGroup = "All";
    renderGroupControls();
    renderItems();
    renderCustomFields();
  }
  closeModal(settingsModal);
});
grid.addEventListener("click", event => {
  const card = event.target.closest("[data-item-id]");
  if (!card) return;
  const item = items.find(candidate => candidate.id === card.dataset.itemId);
  if (item) { renderDetail(item); openModal(detailModal); }
});
groupSelect.addEventListener("change", renderCustomFields);
document.querySelector("#searchInput").addEventListener("input", renderItems);
document.querySelector("#filterButton").addEventListener("click", () => {
  const panel = document.querySelector("#filterPanel");
  panel.hidden = !panel.hidden;
  document.querySelector("#filterButton").classList.toggle("filter-active", !panel.hidden);
});
document.querySelector("#filterPanel").addEventListener("change", event => {
  if (event.target.id === "filterGroup") filters.group = event.target.value;
  if (event.target.id === "filterStock") filters.stock = event.target.value;
  if (event.target.id === "filterPhoto") filters.photo = event.target.value;
  if (event.target.id === "sortItems") filters.sort = event.target.value;
  renderItems();
});
document.querySelector("#clearFilters").addEventListener("click", () => {
  filters.group = "All";
  filters.stock = "all";
  filters.photo = "all";
  filters.sort = "recent";
  document.querySelector("#filterPanel").querySelectorAll("select").forEach(select => select.selectedIndex = 0);
  renderItems();
});
document.querySelector(".view-toggle").addEventListener("click", event => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  currentView = button.dataset.view;
  document.querySelectorAll(".view-toggle button").forEach(control => control.classList.toggle("view-active", control === button));
  renderItems();
});
document.querySelector("#customFields").addEventListener("click", event => {
  const button = event.target.closest(".scan-barcode");
  if (button) startBarcodeScanner(button.dataset.fieldName);
});
document.querySelector("#groupTabs").addEventListener("click", event => {
  const tab = event.target.closest("[data-group]");
  if (!tab) return;
  selectedGroup = tab.dataset.group;
  document.querySelectorAll(".tab").forEach(button => button.classList.toggle("active", button === tab));
  renderItems();
});
async function handlePhotoSelection(event) {
  const file = event.target.files[0];
  if (!file) return;
  selectedPhotoFile = file;
  const selectionToken = ++photoSelectionToken;
  const preview = document.querySelector("#photoPreview");
  const previewImage = preview.querySelector("img");
  try {
    const generatedPhoto = await createThumbnail(file);
    if (selectionToken !== photoSelectionToken) return;
    pendingPhoto = generatedPhoto;
    preview.hidden = false;
    previewImage.src = pendingPhoto.thumbnail;
  } catch (error) {
    resetPhotoPreview();
    window.alert(error.message);
  }
}
document.querySelector("#photoInput").addEventListener("change", handlePhotoSelection);
document.querySelector("#cameraInput").addEventListener("change", handlePhotoSelection);
document.querySelector("#removePhoto").addEventListener("click", resetPhotoPreview);
document.querySelector("#itemForm").addEventListener("submit", async event => {
  event.preventDefault();
  const submitButton = document.querySelector("#itemSubmitButton");
  submitButton.disabled = true;
  try {
    const data = new FormData(event.target);
    const values = {};
    (fieldDefinitions[data.get("group")] || []).forEach(field => {
      if (field.type === "currency") {
        const amount = data.get(field.name);
        if (amount !== "") values[field.name] = { amount, currency: data.get(`${field.name}__currency`) || "USD" };
        return;
      }
      const value = field.type === "multiple" ? data.getAll(field.name) : data.get(field.name);
      if (value && (Array.isArray(value) ? value.length : true)) values[field.name] = field.type === "multiple" ? value : value;
    });
    const file = selectedPhotoFile;
    let photo = pendingPhoto || {};
    if (file && !photo.thumbnail) photo = await createThumbnail(file);
    const existing = editingItemId && items.find(item => item.id === editingItemId);
    const updated = { ...(existing || {}), id: existing?.id || createId(), name: data.get("name"), group: data.get("group"), quantity: data.get("quantity") || 1, values, detail: `${data.get("quantity") || 1} in stock`, price: existing?.price || "—", image: photo.thumbnail || existing?.thumbnail || existing?.image || fallbackImage, thumbnail: photo.thumbnail || existing?.thumbnail || existing?.image || fallbackImage, originalImage: photo.originalImage || existing?.originalImage };
    if (useApiAuth) {
      const payload = JSON.stringify({ name: updated.name, group: updated.group, quantity: updated.quantity, values: updated.values });
      const result = existing
        ? await apiRequest(`/api/items/${encodeURIComponent(existing.id)}`, { method: "PUT", body: payload })
        : await apiRequest("/api/items", { method: "POST", body: payload });
      Object.assign(updated, result.item, { detail: `${result.item.quantity} in stock`, price: "—", thumbnail: fallbackImage, image: fallbackImage });
      if (file) {
        const uploadData = new FormData();
        uploadData.append("image", file);
        const imageResult = await fetch(`/api/items/${encodeURIComponent(result.item.id)}/image`, { method: "POST", credentials: "same-origin", body: uploadData });
        if (!imageResult.ok) throw new Error((await imageResult.json()).error || "The image upload failed.");
        const imageUrls = await imageResult.json();
        Object.assign(updated, { thumbnail: imageUrls.thumbnailUrl, image: imageUrls.originalUrl, originalImage: imageUrls.originalUrl });
      }
    }
    items = existing ? items.map(item => item.id === existing.id ? updated : item) : [updated, ...items];
    persist(); closeModal(modal); event.target.reset(); resetPhotoPreview(); selectedGroup = "All"; renderGroupControls(); renderItems(); renderCustomFields();
    editingItemId = null;
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Unable to save the item.");
  } finally {
    submitButton.disabled = false;
  }
});
document.querySelector("#groupForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const data = new FormData(event.target);
    const name = String(data.get("groupName") || "").trim();
    if (!name) return;
    if (name !== editingGroupName && fieldDefinitions[name]) { window.alert("A group with that name already exists."); return; }
    const rows = [...document.querySelectorAll(".builder-row")];
    const updatedFields = rows.map(row => {
      const label = row.querySelector('[name="fieldLabel"]').value.trim();
      const type = row.querySelector('[name="fieldType"]').value;
      const options = [...row.querySelectorAll('[name="optionValue"]')].map(option => option.value);
      const precision = type === "decimal" ? Math.min(8, Math.max(0, Number(row.querySelector('[name="precision"]').value) || 0)) : type === "currency" ? 2 : undefined;
      return { label, name: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), type, options, showInDashboard: row.querySelector('[name="showInDashboard"]').checked, ...(precision === undefined ? {} : { precision }), placeholder: `Enter ${label.toLowerCase()}` };
    });
    if (useApiAuth) {
      const payload = JSON.stringify(groupPayload(name, updatedFields));
      if (editingGroupName) await apiRequest(`/api/groups/${encodeURIComponent(editingGroupName)}`, { method: "PUT", body: payload });
      else await apiRequest("/api/groups", { method: "POST", body: payload });
    }
    if (editingGroupName && editingGroupName !== name) items = items.map(item => item.group === editingGroupName ? { ...item, group: name } : item);
    if (editingGroupName && editingGroupName !== name) delete fieldDefinitions[editingGroupName];
    fieldDefinitions[name] = updatedFields;
    persist(); closeModal(createGroupModal); event.target.reset(); renderGroupControls(); renderCustomFields(); renderGroupList();
    editingGroupName = null;
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Unable to save the group.");
  }
});
renderGroupControls();
renderItems();
renderCustomFields();
async function initializeAuthentication() {
  if (!useApiAuth) {
    const signedInUser = getSignedInUser();
    if (signedInUser) showAuthenticatedApp(signedInUser);
    else showAuthScreen();
    return;
  }
  try {
    const result = await apiRequest("/api/auth/me");
    showAuthenticatedApp(result.user);
    try {
      await loadApiInventory();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to load inventory.");
    }
  } catch {
    showAuthScreen();
  }
}

initializeAuthentication();
