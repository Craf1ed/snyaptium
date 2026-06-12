import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, doc, getDocs, query, where, deleteDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const FIREBASE_WORKER_URL = 'https://snyaptium-firebase.craftedgamz.workers.dev';

let app, auth, db;
let currentUser = null;
let userCharacters = [];

async function loadEnv() {
  const res = await fetch(FIREBASE_WORKER_URL, { headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'snyaptium-firebase' } });
  if (!res.ok) throw new Error('Failed to load Firebase config');
  const { firebaseConfig } = await res.json();
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

await loadEnv();

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'signup.html'; return; }
  currentUser = user;
  try {
    await loadProfile();
    await loadCharacters();
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';
    bindEvents();
  } catch (error) {
    console.error('Error during initialization:', error);
    toast('Error loading app. Please refresh the page.', 'error');
  }
});

async function loadProfile() {
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  const data = snap.exists() ? snap.data() : {};
  const name = data.displayName || currentUser.displayName || currentUser.email || 'User';

  document.getElementById('sidebarName').textContent = name;
  document.getElementById('sidebarEmail').textContent = currentUser.email || '';
  updateSidebarAvatar(name);
}

function updateSidebarAvatar(name) {
  const el = document.getElementById('sidebarAvatar');
  el.innerHTML = (name || 'U')[0].toUpperCase();
}

async function loadCharacters() {
  try {
    const snap = await getDocs(query(collection(db, 'characters'), where('userId', '==', currentUser.uid)));
    userCharacters = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCharacterList();
  } catch (e) {
    console.error('Error loading characters:', e);
    userCharacters = [];
    renderCharacterList();
  }
}

function renderCharacterList() {
  const list = document.getElementById('botList');
  const empty = document.getElementById('botEmpty');

  list.querySelectorAll('.bot-item').forEach(el => el.remove());

  if (userCharacters.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  userCharacters.forEach(character => {
    const item = document.createElement('div');
    item.className = 'bot-item';
    item.innerHTML = `
      <div class="bot-item-content">
        <span class="bot-item-name">${escapeHtml(character.name)}</span>
        <span class="bot-item-prompt">${escapeHtml(character.prompt.substring(0, 100))}${character.prompt.length > 100 ? '...' : ''}</span>
      </div>
      <div class="bot-item-actions">
        <button class="bot-edit-btn" data-id="${character.id}" title="Edit">
          <i class="fas fa-edit"></i>
        </button>
        <button class="bot-delete-btn" data-id="${character.id}" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>`;
    item.querySelector('.bot-edit-btn').addEventListener('click', () => editCharacter(character.id));
    item.querySelector('.bot-delete-btn').addEventListener('click', () => deleteCharacter(character.id));
    list.appendChild(item);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(message, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show ' + type;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmOverlay');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const cancelBtn = document.getElementById('confirmCancel');
    const deleteBtn = document.getElementById('confirmDelete');

    titleEl.textContent = title;
    messageEl.textContent = message;
    overlay.classList.add('active');

    const onConfirm = () => {
      overlay.classList.remove('active');
      cancelBtn.removeEventListener('click', onCancel);
      deleteBtn.removeEventListener('click', onConfirm);
      resolve(true);
    };

    const onCancel = () => {
      overlay.classList.remove('active');
      cancelBtn.removeEventListener('click', onCancel);
      deleteBtn.removeEventListener('click', onConfirm);
      resolve(false);
    };

    cancelBtn.addEventListener('click', onCancel);
    deleteBtn.addEventListener('click', onConfirm);
  });
}

async function createCharacter() {
  const nameInput = document.getElementById('botNameInput');
  const promptInput = document.getElementById('botPromptInput');
  const name = nameInput.value.trim();
  const prompt = promptInput.value.trim();
  if (!name || !prompt) { toast('Both name and prompt are required.', 'error'); return; }

  try {
    await addDoc(collection(db, 'characters'), {
      userId: currentUser.uid,
      name,
      prompt,
      createdAt: serverTimestamp()
    });
    await loadCharacters();
    nameInput.value = '';
    promptInput.value = '';
    toast(`Character "${name}" created successfully!`, 'success');
  } catch (e) {
    toast('Error creating character: ' + e.message, 'error');
  }
}

async function editCharacter(characterId) {
  const character = userCharacters.find(c => c.id === characterId);
  if (!character) return;

  const nameInput = document.getElementById('botNameInput');
  const promptInput = document.getElementById('botPromptInput');
  nameInput.value = character.name;
  promptInput.value = character.prompt;

  const createBtn = document.getElementById('createBotBtn');
  createBtn.innerHTML = '<i class="fas fa-check"></i> Update Character';
  createBtn.onclick = async () => {
    const name = nameInput.value.trim();
    const prompt = promptInput.value.trim();
    if (!name || !prompt) { toast('Both name and prompt are required.', 'error'); return; }

    try {
      await setDoc(doc(db, 'characters', characterId), {
        userId: currentUser.uid,
        name,
        prompt,
        updatedAt: serverTimestamp()
      }, { merge: true });
      await loadCharacters();
      nameInput.value = '';
      promptInput.value = '';
      createBtn.innerHTML = '<i class="fas fa-plus"></i> Create Character';
      createBtn.onclick = createCharacter;
      toast('Character updated successfully!', 'success');
    } catch (e) {
      toast('Error updating character: ' + e.message, 'error');
    }
  };

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteCharacter(characterId) {
  const ok = await showConfirm('Delete Character?', 'This character will be permanently deleted.');
  if (!ok) return;

  try {
    await deleteDoc(doc(db, 'characters', characterId));
    await loadCharacters();
    toast('Character deleted successfully!', 'success');
  } catch (e) {
    toast('Error deleting character: ' + e.message, 'error');
  }
}

function bindEvents() {
  document.getElementById('createBotBtn').addEventListener('click', createCharacter);
  document.getElementById('logoutBtn').addEventListener('click', async () => { await signOut(auth); window.location.href = 'signup.html'; });
}
