import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, updateProfile, updatePassword } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, deleteDoc, query, where, serverTimestamp, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { getStorage, ref, deleteObject } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";

const FIREBASE_WORKER_URL = 'https://snyaptium-firebase.craftedgamz.workers.dev';

let app, auth, db, storage;
let currentUser    = null;
let userProfilePic = null;
let pendingPicData = null;
let userMemory     = {};

async function loadEnv() {
  const res = await fetch(FIREBASE_WORKER_URL, { headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'snyaptium-firebase' } });
  if (!res.ok) throw new Error('Failed to load Firebase config');
  const { firebaseConfig } = await res.json();
  app     = initializeApp(firebaseConfig);
  auth    = getAuth(app);
  db      = getFirestore(app);
  storage = getStorage(app);
}

await loadEnv();

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => { el.className = 'toast'; }, 3200);
}

function showConfirm(title, message, label = 'Confirm') {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent   = title;
    document.getElementById('confirmMessage').textContent = message;
    const delBtn = document.getElementById('confirmDelete');
    delBtn.innerHTML = `<i class="fas fa-trash"></i> ${label}`;
    overlay.classList.add('active');
    const cleanup = (v) => {
      overlay.classList.remove('active');
      delBtn.removeEventListener('click', onD);
      document.getElementById('confirmCancel').removeEventListener('click', onC);
      document.removeEventListener('keydown', onK);
      overlay.removeEventListener('click', onO);
      resolve(v);
    };
    const onD = () => cleanup(true);
    const onC = () => cleanup(false);
    const onK = (e) => { if (e.key === 'Escape') cleanup(false); };
    const onO = (e) => { if (e.target === overlay) cleanup(false); };
    delBtn.addEventListener('click', onD);
    document.getElementById('confirmCancel').addEventListener('click', onC);
    document.addEventListener('keydown', onK);
    overlay.addEventListener('click', onO);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'signup.html'; return; }
  currentUser = user;
  await loadProfile();
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
  bindEvents();
});

async function loadProfile() {
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  const data = snap.exists() ? snap.data() : {};
  const name = data.displayName || currentUser.displayName || currentUser.email || 'User';
  userProfilePic = data.profilePicURL || null;
  userMemory     = data.memory || {};

  document.getElementById('sidebarName').textContent  = name;
  document.getElementById('sidebarEmail').textContent = currentUser.email || '';
  updateSidebarAvatar(name, userProfilePic);
  document.getElementById('settingsName').value  = name;
  document.getElementById('settingsEmail').value = currentUser.email || '';
  setAvatarPreview(userProfilePic, name);
  renderMemoryList();
}

function updateSidebarAvatar(name, pic) {
  const el = document.getElementById('sidebarAvatar');
  el.innerHTML = pic ? `<img src="${pic}" alt="avatar">` : (name || 'U')[0].toUpperCase();
}

function setAvatarPreview(pic, name) {
  const el = document.getElementById('avatarPreview');
  el.innerHTML = pic ? `<img src="${pic}" alt="avatar">` : `<span id="avatarInitial">${(name || 'U')[0].toUpperCase()}</span>`;
}

function renderMemoryList() {
  const list  = document.getElementById('memoryList');
  const empty = document.getElementById('memoryEmpty');
  const entries = Object.entries(userMemory);

  list.querySelectorAll('.memory-item').forEach(el => el.remove());

  if (entries.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  entries.forEach(([key, value]) => {
    const item = document.createElement('div');
    item.className = 'memory-item';
    item.innerHTML = `
      <div class="memory-item-content">
        <span class="memory-item-key">${escapeHtml(key)}</span>
        <span class="memory-item-value">${escapeHtml(value)}</span>
      </div>
      <button class="memory-delete-btn" data-key="${escapeHtml(key)}" title="Remove">
        <i class="fas fa-times"></i>
      </button>`;
    item.querySelector('.memory-delete-btn').addEventListener('click', () => deleteMemoryEntry(key));
    list.appendChild(item);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function saveMemory() {
  await setDoc(doc(db, 'users', currentUser.uid), { memory: userMemory }, { merge: true });
}

async function deleteMemoryEntry(key) {
  delete userMemory[key];
  await saveMemory();
  renderMemoryList();
  toast(`Removed "${key}" from memory.`);
}

function bindEvents() {
  document.getElementById('profilePicInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { pendingPicData = ev.target.result; document.getElementById('avatarPreview').innerHTML = `<img src="${pendingPicData}" alt="avatar">`; };
    reader.readAsDataURL(file);
  });

  document.getElementById('removePicBtn').addEventListener('click', () => {
    pendingPicData = null; userProfilePic = null;
    const name = document.getElementById('settingsName').value || 'U';
    document.getElementById('avatarPreview').innerHTML = `<span id="avatarInitial">${name[0].toUpperCase()}</span>`;
    document.getElementById('profilePicInput').value = '';
  });

  document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);

  document.getElementById('addMemoryBtn').addEventListener('click', addMemoryEntry);
  document.getElementById('memoryKeyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemoryEntry(); });
  document.getElementById('memoryValueInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemoryEntry(); });

  bindPasswordToggle('settingsPassword', 'togglePwd');
  bindPasswordToggle('settingsPasswordConfirm', 'togglePwdConfirm');
  document.getElementById('settingsPassword').addEventListener('input', updateStrengthMeter);
  document.getElementById('savePasswordBtn').addEventListener('click', savePassword);

  document.getElementById('clearMemoryBtn').addEventListener('click', clearAllMemory);
  document.getElementById('deleteAllChatsBtn').addEventListener('click', deleteAllChats);
  document.getElementById('deleteAccountBtn').addEventListener('click', deleteAccount);
  document.getElementById('logoutBtn').addEventListener('click', async () => { await signOut(auth); window.location.href = 'signup.html'; });
}

async function addMemoryEntry() {
  const keyInput = document.getElementById('memoryKeyInput');
  const valInput = document.getElementById('memoryValueInput');
  const key   = keyInput.value.trim();
  const value = valInput.value.trim();
  if (!key || !value) { toast('Both label and value are required.', 'error'); return; }
  userMemory[key] = value;
  await saveMemory();
  renderMemoryList();
  keyInput.value = ''; valInput.value = '';
  toast(`Saved "${key}" to memory.`, 'success');
}

async function clearAllMemory() {
  const ok = await showConfirm('Clear AI Memory?', 'This will delete all facts the AI knows about you. This cannot be undone.', 'Clear Memory');
  if (!ok) return;
  userMemory = {};
  await saveMemory();
  renderMemoryList();
  toast('AI memory cleared.', 'success');
}

function bindPasswordToggle(inputId, btnId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const input = document.getElementById(inputId);
    const btn   = document.getElementById(btnId);
    const show  = input.type === 'password';
    input.type  = show ? 'text' : 'password';
    btn.innerHTML = show ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
  });
}

function updateStrengthMeter() {
  const val  = document.getElementById('settingsPassword').value;
  const wrap = document.getElementById('pwdStrength');
  const fill = document.getElementById('pwdBarFill');
  const label= document.getElementById('pwdLabel');
  if (!val) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  let score = 0;
  if (val.length >= 8) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  const cfg = [
    { pct: '25%', color: '#ff4444', text: 'Weak' },
    { pct: '50%', color: '#e0963a', text: 'Fair' },
    { pct: '75%', color: '#e0c93a', text: 'Good' },
    { pct: '100%', color: 'rgba(255,255,255,0.8)', text: 'Strong' },
  ][score - 1] || { pct: '25%', color: '#ff4444', text: 'Weak' };
  fill.style.width = cfg.pct; fill.style.background = cfg.color;
  label.style.color = cfg.color; label.textContent = cfg.text;
}

async function saveProfile() {
  const btn  = document.getElementById('saveProfileBtn');
  const name = document.getElementById('settingsName').value.trim();
  if (!name) { toast('Name cannot be empty.', 'error'); return; }
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    let pic = userProfilePic;
    if (pendingPicData) { pic = pendingPicData; }
    else if (!document.getElementById('avatarPreview').querySelector('img')) {
      if (userProfilePic) { try { await deleteObject(ref(storage, `profilePics/${currentUser.uid}`)); } catch (_) {} }
      pic = null;
    }
    await updateProfile(currentUser, { displayName: name });
    await setDoc(doc(db, 'users', currentUser.uid), { displayName: name, profilePicURL: pic, updatedAt: serverTimestamp() }, { merge: true });
    userProfilePic = pic; pendingPicData = null;
    updateSidebarAvatar(name, userProfilePic);
    toast('Profile saved!', 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Save Profile'; }
}

async function savePassword() {
  const btn  = document.getElementById('savePasswordBtn');
  const pwd  = document.getElementById('settingsPassword').value;
  const conf = document.getElementById('settingsPasswordConfirm').value;
  if (!pwd)         { toast('Enter a new password first.', 'error'); return; }
  if (pwd !== conf) { toast('Passwords do not match.', 'error'); return; }
  if (pwd.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating…';
  try {
    await updatePassword(currentUser, pwd);
    document.getElementById('settingsPassword').value = '';
    document.getElementById('settingsPasswordConfirm').value = '';
    document.getElementById('pwdStrength').style.display = 'none';
    toast('Password updated!', 'success');
  } catch (e) {
    toast(e.code === 'auth/requires-recent-login' ? 'Please log out and back in, then try again.' : 'Error: ' + e.message, 'error');
  } finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-key"></i> Update Password'; }
}

async function deleteAllChats() {
  const ok = await showConfirm('Delete All Chats?', 'This will permanently remove all your conversation history. Cannot be undone.', 'Delete All Chats');
  if (!ok) return;
  try {
    const qs = await getDocs(query(collection(db, 'chats'), where('userId', '==', currentUser.uid)));
    await Promise.all(qs.docs.map(d => deleteDoc(d.ref)));
    toast(`Deleted ${qs.size} chat${qs.size !== 1 ? 's' : ''}.`, 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteAccount() {
  const ok = await showConfirm('Delete Account?', 'This will permanently erase your account, all chats, memory, and all stored data. You will be logged out immediately. This cannot be undone.', 'Delete My Account');
  if (!ok) return;
  try {
    const qs = await getDocs(query(collection(db, 'chats'), where('userId', '==', currentUser.uid)));
    await Promise.all(qs.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'users', currentUser.uid));
    if (userProfilePic) { try { await deleteObject(ref(storage, `profilePics/${currentUser.uid}`)); } catch (_) {} }
    await currentUser.delete();
    window.location.href = 'signup.html';
  } catch (e) {
    toast(e.code === 'auth/requires-recent-login' ? 'Please log out and back in, then delete your account.' : 'Error: ' + e.message, 'error');
  }
}