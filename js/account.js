import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut,
  updateProfile, updatePassword
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getFirestore, collection, doc,
  getDocs, deleteDoc, query, where,
  serverTimestamp, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import {
  getStorage, ref, deleteObject
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";

const FIREBASE_WORKER_URL = 'https://snyaptium-firebase.craftedgamz.workers.dev';
const AI_KEY_WORKER_URL   = 'https://snyaptium-ai.craftedgamz.workers.dev';

let firebaseConfig, app, auth, db, storage;
let currentUser = null;
let userProfilePic = null;
let pendingPicData = null;

async function loadEnv() {
  const [fbRes] = await Promise.all([
    fetch(FIREBASE_WORKER_URL, {
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'snyaptium-firebase' }
    })
  ]);
  if (!fbRes.ok) throw new Error('Failed to load Firebase config');
  const fbData = await fbRes.json();
  firebaseConfig = fbData.firebaseConfig;
}

await loadEnv();
app     = initializeApp(firebaseConfig);
auth    = getAuth(app);
db      = getFirestore(app);
storage = getStorage(app);

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => { el.className = 'toast'; }, 3200);
}

function showConfirm(title, message, confirmLabel = 'Confirm') {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent   = title;
    document.getElementById('confirmMessage').textContent = message;
    const delBtn = document.getElementById('confirmDelete');
    delBtn.innerHTML = `<i class="fas fa-trash"></i> ${confirmLabel}`;
    overlay.classList.add('active');

    const cleanup = (val) => {
      overlay.classList.remove('active');
      delBtn.removeEventListener('click', onDel);
      document.getElementById('confirmCancel').removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      overlay.removeEventListener('click', onOverlay);
      resolve(val);
    };
    const onDel     = () => cleanup(true);
    const onCancel  = () => cleanup(false);
    const onKey     = (e) => { if (e.key === 'Escape') cleanup(false); };
    const onOverlay = (e) => { if (e.target === overlay) cleanup(false); };

    delBtn.addEventListener('click', onDel);
    document.getElementById('confirmCancel').addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', onOverlay);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'signup.html';
    return;
  }
  currentUser = user;
  await loadProfile();
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
  bindEvents();
});

async function loadProfile() {
  const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
  const data    = userDoc.exists() ? userDoc.data() : {};

  const displayName = data.displayName || currentUser.displayName || currentUser.email || 'User';
  userProfilePic    = data.profilePicURL || null;

  document.getElementById('sidebarName').textContent  = displayName;
  document.getElementById('sidebarEmail').textContent = currentUser.email || '';
  updateSidebarAvatar(displayName, userProfilePic);

  document.getElementById('settingsName').value  = displayName;
  document.getElementById('settingsEmail').value = currentUser.email || '';


  setAvatarPreview(userProfilePic, displayName);
}

function updateSidebarAvatar(name, picURL) {
  const el = document.getElementById('sidebarAvatar');
  if (picURL) {
    el.innerHTML = `<img src="${picURL}" alt="avatar">`;
  } else {
    el.textContent = (name || 'U')[0].toUpperCase();
  }
}

function setAvatarPreview(picURL, name) {
  const el = document.getElementById('avatarPreview');
  if (picURL) {
    el.innerHTML = `<img src="${picURL}" alt="avatar">`;
  } else {
    el.innerHTML = `<span id="avatarInitial">${(name || 'U')[0].toUpperCase()}</span>`;
  }
}

function bindEvents() {

  document.getElementById('profilePicInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingPicData = ev.target.result;
      document.getElementById('avatarPreview').innerHTML = `<img src="${pendingPicData}" alt="avatar">`;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('removePicBtn').addEventListener('click', () => {
    pendingPicData = null;
    userProfilePic = null;
    const name = document.getElementById('settingsName').value || 'U';
    document.getElementById('avatarPreview').innerHTML =
      `<span id="avatarInitial">${name[0].toUpperCase()}</span>`;
    document.getElementById('profilePicInput').value = '';
  });

  document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
  bindPasswordToggle('settingsPassword',        'togglePwd');
  bindPasswordToggle('settingsPasswordConfirm', 'togglePwdConfirm');
  document.getElementById('settingsPassword').addEventListener('input', updateStrengthMeter);
  document.getElementById('savePasswordBtn').addEventListener('click', savePassword);
  document.getElementById('deleteAllChatsBtn').addEventListener('click', deleteAllChats);
  document.getElementById('deleteAccountBtn').addEventListener('click', deleteAccount);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'signup.html';
  });
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
  if (val.length >= 8)            score++;
  if (/[A-Z]/.test(val))         score++;
  if (/[0-9]/.test(val))         score++;
  if (/[^A-Za-z0-9]/.test(val))  score++;

  const configs = [
    { pct: '25%', color: '#e05252', text: 'Weak'   },
    { pct: '50%', color: '#e0963a', text: 'Fair'   },
    { pct: '75%', color: '#e0c93a', text: 'Good'   },
    { pct: '100%',color: '#5ee7c2', text: 'Strong' },
  ];
  const cfg = configs[score - 1] || configs[0];
  fill.style.width      = cfg.pct;
  fill.style.background = cfg.color;
  label.style.color     = cfg.color;
  label.textContent     = cfg.text;
}

async function saveProfile() {
  const btn  = document.getElementById('saveProfileBtn');
  const name = document.getElementById('settingsName').value.trim();

  if (!name) { toast('Name cannot be empty.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    let profilePicURL = userProfilePic;

    if (pendingPicData) {
      profilePicURL = pendingPicData;
    } else if (!document.getElementById('avatarPreview').querySelector('img')) {
      if (userProfilePic) {
        try {
          const storageRef = ref(storage, `profilePics/${currentUser.uid}`);
          await deleteObject(storageRef);
        } catch (_) {}
      }
      profilePicURL = null;
    }

    await updateProfile(currentUser, { displayName: name });
    await setDoc(doc(db, 'users', currentUser.uid), {
      displayName:   name,
      profilePicURL: profilePicURL,
      updatedAt:     serverTimestamp()
    }, { merge: true });

    userProfilePic  = profilePicURL;
    pendingPicData  = null;

    updateSidebarAvatar(name, userProfilePic);
    toast('Profile saved!', 'success');
  } catch (err) {
    console.error(err);
    toast('Error saving profile: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> Save Profile';
  }
}

async function savePassword() {
  const btn  = document.getElementById('savePasswordBtn');
  const pwd  = document.getElementById('settingsPassword').value;
  const conf = document.getElementById('settingsPasswordConfirm').value;

  if (!pwd) { toast('Enter a new password first.', 'error'); return; }
  if (pwd !== conf) { toast('Passwords do not match.', 'error'); return; }
  if (pwd.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating…';

  try {
    await updatePassword(currentUser, pwd);
    document.getElementById('settingsPassword').value        = '';
    document.getElementById('settingsPasswordConfirm').value = '';
    document.getElementById('pwdStrength').style.display     = 'none';
    toast('Password updated!', 'success');
  } catch (err) {
    console.error(err);
    if (err.code === 'auth/requires-recent-login') {
      toast('Please log out and log back in, then try again.', 'error');
    } else {
      toast('Error: ' + err.message, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-key"></i> Update Password';
  }
}

async function deleteAllChats() {
  const ok = await showConfirm(
    'Delete All Chats?',
    'This will permanently remove all your conversation history. This cannot be undone.',
    'Delete All Chats'
  );
  if (!ok) return;

  try {
    const q  = query(collection(db, 'chats'), where('userId', '==', currentUser.uid));
    const qs = await getDocs(q);
    await Promise.all(qs.docs.map(d => deleteDoc(d.ref)));
    toast(`Deleted ${qs.size} chat${qs.size !== 1 ? 's' : ''}.`, 'success');
  } catch (err) {
    console.error(err);
    toast('Error: ' + err.message, 'error');
  }
}
async function deleteAccount() {
  const ok = await showConfirm(
    'Delete Account?',
    'This will permanently erase your account, all chats, and all stored data. You will be logged out immediately and this cannot be undone.',
    'Delete My Account'
  );
  if (!ok) return;

  try {
    const q  = query(collection(db, 'chats'), where('userId', '==', currentUser.uid));
    const qs = await getDocs(q);
    await Promise.all(qs.docs.map(d => deleteDoc(d.ref)));

    await deleteDoc(doc(db, 'users', currentUser.uid));

    if (userProfilePic) {
      try {
        await deleteObject(ref(storage, `profilePics/${currentUser.uid}`));
      } catch (_) {}
    }

    await currentUser.delete();
    window.location.href = 'signup.html';
  } catch (err) {
    console.error(err);
    if (err.code === 'auth/requires-recent-login') {
      toast('Please log out and log back in, then delete your account.', 'error');
    } else {
      toast('Error: ' + err.message, 'error');
    }
  }
}