import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, doc, getDocs, query, where, deleteDoc, serverTimestamp, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const FIREBASE_WORKER_URL = 'https://snyaptium-firebase.craftedgamz.workers.dev';
const AI_KEY_WORKER_URL   = 'https://snyaptium-ai.craftedgamz.workers.dev';

let firebaseConfig;
let API_KEY;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

let currentVoice = 'daniel';

async function loadEnv() {
  const [firebaseRes, aiRes] = await Promise.all([
    fetch(FIREBASE_WORKER_URL, { method: 'GET', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'snyaptium-firebase' } }),
    fetch(AI_KEY_WORKER_URL,   { method: 'GET', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'snyaptium-ai' } })
  ]);
  if (!firebaseRes.ok || !aiRes.ok) throw new Error('Failed to load configuration');
  firebaseConfig = (await firebaseRes.json()).firebaseConfig;
  API_KEY        = (await aiRes.json()).apiKey;
}

await loadEnv();

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let currentUser    = null;
let currentModel   = 'llama-3.3-70b-versatile';
let messages       = [];
let currentChatId  = null;
let chatHistory    = [];
let aiRecommendations           = [];
let isGeneratingRecommendations = false;
let userProfilePic = null;
let userMemory     = {};
let userCharacters = [];
let currentCharacter = null;
let recognition    = null;
let isListening    = false;
let currentAudio   = null;
let pendingImage   = null;
let isAdultContent = false;
let ageConfirmed   = false;

function buildSystemPrompt() {
  let content = currentCharacter ? currentCharacter.prompt : 'You are Snyaptium AI, an intelligent and helpful AI assistant created by Snyaptium. You are designed to assist users with a wide variety of tasks including answering questions, writing, coding, analysis, creative tasks, and more. You are knowledgeable, friendly, and professional. Always strive to provide accurate, helpful, and comprehensive responses.';

  const entries = Object.entries(userMemory);
  if (entries.length > 0) {
    content += '\n\nYou know the following facts about this user:\n';
    entries.forEach(([k, v]) => { content += `- ${k}: ${v}\n`; });
  }

  content += '\n\nYou have a silent memory system. When the user reveals a personal fact worth remembering (name, job, location, hobby, preference, goal, etc.), you MUST append the following block at the very end of your response, after all other text, with NO explanation, NO mention of it, and NO text after it:\n[MEMORY:{"key":"short label","value":"the fact"}]\nCritical rules: never tell the user you are saving anything, never say "I will remember", never reference the block in your reply at all. The block is invisible to the user. Only one block per response. Only save genuinely useful persistent facts.';

  return { role: 'system', content };
}

async function loadUserMemory() {
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    userMemory = snap.exists() ? (snap.data().memory || {}) : {};
  } catch (_) {
    userMemory = {};
  }
}

async function loadUserCharacters() {
  try {
    const snap = await getDocs(query(collection(db, 'characters'), where('userId', '==', currentUser.uid)));
    userCharacters = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateCharacterOptions();
  } catch (e) {
    console.error('Error loading characters:', e);
    userCharacters = [];
    updateCharacterOptions();
  }
}

function updateCharacterOptions() {
  const list = document.getElementById('botOptionsList');
  const tip = document.getElementById('characterTip');
  if (!list) return;
  list.innerHTML = '';
  userCharacters.forEach(character => {
    const option = document.createElement('div');
    option.className = 'bot-option';
    option.setAttribute('data-bot-id', character.id);
    option.innerHTML = `
      <div class="bot-option-name">${escapeHtml(character.name)}</div>
      <div class="bot-option-desc">${escapeHtml(character.prompt.substring(0, 60))}${character.prompt.length > 60 ? '...' : ''}</div>
    `;
    option.addEventListener('click', () => selectCharacter(character));
    list.appendChild(option);
  });
  if (tip) {
    tip.style.display = userCharacters.length === 0 ? 'flex' : 'none';
  }
}

function selectCharacter(character) {
  currentCharacter = character;
  document.getElementById('selectedBot').textContent = character ? character.name : 'Choose a custom character';
  document.querySelectorAll('.bot-option').forEach(o => o.classList.remove('selected'));
  if (character) {
    const option = document.querySelector(`.bot-option[data-bot-id="${character.id}"]`);
    if (option) option.classList.add('selected');
  } else {
    document.querySelector('.bot-option[data-bot-id=""]').classList.add('selected');
  }
  document.getElementById('botOverlay').classList.remove('active');
  addSystemMessage(character ? `Now chatting with ${character.name}` : 'Now using default Snyaptium');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function saveMemoryEntry(key, value) {
  try {
    if (!key?.trim() || !value?.trim()) return;
    userMemory[key.trim()] = value.trim();
    await setDoc(doc(db, 'users', currentUser.uid), { memory: userMemory }, { merge: true });
  } catch (e) {
    console.error('Failed to save memory entry:', e);
  }
}

function extractAndStripMemory(text) {
  console.log('extractAndStripMemory called with text:', text.substring(0, 100));
  // Match various memory JSON formats
  const patterns = [
    /\[MEMORY:\s*(\{[^}]*\})\s*\]/,
    /\[MEMORY:(\{[^}]+\})\][\s\r\n]*/,
    /\{[\s\S]*?"memory"[\s\S]*?\{[\s\S]*?\}[\s\S]*?\}/,
    /\{[\s\S]*?"key"[\s\S]*?"value"[\s\S]*?\}/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      console.log('Memory matched with pattern:', pattern);
      console.log('Match groups:', match);
      let entry = null;
      try {
        // Try to parse as JSON
        const jsonStr = match[1] || match[0];
        entry = JSON.parse(jsonStr);
        // If it's a nested structure, extract the memory part
        if (entry.memory) entry = entry.memory;
        console.log('Parsed memory entry:', entry);
      } catch (_) {
        console.log('JSON parse failed, trying key-value extraction');
        // Try to extract key-value from the matched string
        const keyMatch = match[0].match(/"key"\s*:\s*"([^"]+)"/);
        const valueMatch = match[0].match(/"value"\s*:\s*"([^"]+)"/);
        if (keyMatch && valueMatch) {
          entry = { key: keyMatch[1], value: valueMatch[1] };
          console.log('Extracted key-value:', entry);
        }
      }
      const cleanText = text.slice(0, match.index).trimEnd();
      console.log('Cleaned text length:', cleanText.length);
      console.log('Cleaned text:', cleanText.substring(0, 100));
      return { clean: cleanText, entry };
    }
  }

  console.log('No memory pattern matched');
  return { clean: text, entry: null };
}

window.extractAndStripMemory = extractAndStripMemory;
window.saveMemoryEntry = saveMemoryEntry;

function initImageUpload() {
  const input = document.getElementById('imageUploadInput');
  if (!input) return;
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert('Image must be under 4MB.');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64  = dataUrl.split(',')[1];
      pendingImage  = { base64, mimeType: file.type, previewUrl: dataUrl };
      showImagePreview(dataUrl);
    };
    reader.readAsDataURL(file);
    input.value = '';
  });
}

function showImagePreview(url) {
  let preview = document.getElementById('imagePreviewBar');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'imagePreviewBar';
    preview.className = 'image-preview-bar';
    const inputArea = document.querySelector('.input-wrapper');
    inputArea.parentElement.insertBefore(preview, inputArea);
  }
  preview.innerHTML = `
    <div class="image-preview-thumb-wrap">
      <img src="${url}" class="image-preview-thumb" alt="Attached image">
      <button class="image-preview-remove" onclick="clearPendingImage()" title="Remove image">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <span class="image-preview-label"><i class="fas fa-eye"></i> Vision mode — using Llama 4 Scout</span>
  `;
}

window.clearPendingImage = function () {
  pendingImage = null;
  document.getElementById('imagePreviewBar')?.remove();
};

function addMessageToUIWithImage(text, imageDataUrl, type) {
  hideWelcomeScreen();
  const cc = document.getElementById('chatContainer');
  const w  = document.createElement('div'); w.className = `message-wrapper ${type}`;
  const av = document.createElement('div'); av.className = `avatar ${type}`;
  if (userProfilePic) { av.classList.add('has-image'); const img = document.createElement('img'); img.src = userProfilePic; img.alt = 'User'; av.appendChild(img); }
  else { av.textContent = (currentUser.displayName || currentUser.email || 'U')[0].toUpperCase(); }
  const mc = document.createElement('div'); mc.className = 'message-content';
  if (imageDataUrl) {
    const imgEl = document.createElement('img');
    imgEl.src = imageDataUrl;
    imgEl.className = 'user-attached-image';
    imgEl.alt = 'Attached image';
    mc.appendChild(imgEl);
  }
  if (text) {
    const p = document.createElement('p'); p.textContent = text; mc.appendChild(p);
  }
  w.appendChild(av); w.appendChild(mc); cc.appendChild(w); cc.scrollTop = cc.scrollHeight;
}

function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
  recognition.onresult = (e) => { document.getElementById('userInput').value = e.results[0][0].transcript; autoResize(document.getElementById('userInput')); };
  recognition.onerror  = () => stopVoiceInput();
  recognition.onend    = () => stopVoiceInput();
}

function initMobileUI() {
  if (window.innerWidth > 768 || document.querySelector('.mobile-header')) return;
  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    const h = document.createElement('div');
    h.className = 'mobile-header';
    h.innerHTML = `<button class="mobile-menu-btn" onclick="toggleMobileSidebar()"><i class="fas fa-bars"></i></button><div class="mobile-logo">Snyaptium</div><button class="mobile-new-chat-btn" onclick="newChat()"><i class="fas fa-plus"></i></button>`;
    mainContent.insertBefore(h, mainContent.firstChild);
  }
  if (!document.querySelector('.mobile-sidebar-overlay')) {
    const ov = document.createElement('div');
    ov.className = 'mobile-sidebar-overlay';
    ov.onclick   = () => toggleMobileSidebar();
    document.body.appendChild(ov);
  }
}

window.toggleMobileSidebar = function () {
  document.querySelector('.sidebar')?.classList.toggle('mobile-open');
  document.querySelector('.mobile-sidebar-overlay')?.classList.toggle('active');
};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'signup.html'; return; }
  currentUser = user;
  try {
    await loadUserProfile();
    await loadUserMemory();
    await loadUserCharacters();
    initSpeechRecognition();
    initImageUpload();
    await loadChatHistory();
    initCustomDropdown();
    initBotSelector();
    initMobileUI();
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('mainApp').style.display       = 'flex';
    setTimeout(generateRecommendations, 1000);
  document.querySelectorAll('.voice-option').forEach(v => {
    v.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.voice-option').forEach(x => x.classList.remove('selected'));
      v.classList.add('selected');
      currentVoice = v.getAttribute('data-voice');
    });
  });
  } catch (error) {
    console.error('Error during initialization:', error);
    alert('Error loading app. Please refresh the page.');
  }
});

async function loadUserProfile() {
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    const data = snap.exists() ? snap.data() : {};
    const displayName = data.displayName || currentUser.displayName || currentUser.email;
    userProfilePic    = data.profilePicURL || null;
    document.getElementById('userName').textContent     = displayName;
    document.getElementById('welcomeTitle').textContent = `Welcome to Snyaptium, ${displayName.split(' ')[0]}`;
  } catch (_) {
    document.getElementById('userName').textContent = currentUser.displayName || currentUser.email;
  }
}

window.handleLogout = async function () {
  try { await signOut(auth); window.location.href = 'signup.html'; } catch (e) { console.error(e); }
};

async function loadChatHistory() {
  try {
    const snap = await getDocs(query(collection(db, 'chats'), where('userId', '==', currentUser.uid)));
    chatHistory = [];
    snap.forEach((d) => chatHistory.push({ id: d.id, ...d.data() }));
    chatHistory.sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0));
    updateHistoryList();
  } catch (e) { console.error('Error loading chat history:', e); }
}

function updateHistoryList() {
  document.getElementById('historyList').innerHTML = chatHistory.map(c => `
    <div class="history-item ${currentChatId === c.id ? 'active' : ''}" onclick="loadChat('${c.id}'); window.innerWidth <= 768 && toggleMobileSidebar();">
      <div class="history-item-title">${c.title || 'New Chat'}</div>
      <button class="delete-chat-btn" onclick="event.stopPropagation(); deleteChat('${c.id}')"><i class="fas fa-trash"></i></button>
    </div>`).join('');
}

window.deleteChat = async function (chatId) {
  const overlay = document.getElementById('confirmOverlay');
  const delBtn  = document.getElementById('confirmDelete');
  const canBtn  = document.getElementById('confirmCancel');
  overlay.classList.add('active');
  const ok = await new Promise((resolve) => {
    const cleanup = () => { delBtn.removeEventListener('click', onD); canBtn.removeEventListener('click', onC); document.removeEventListener('keydown', onK); overlay.removeEventListener('click', onO); overlay.classList.remove('active'); };
    const onD = () => { cleanup(); resolve(true); };
    const onC = () => { cleanup(); resolve(false); };
    const onK = (e) => { if (e.key === 'Escape') { cleanup(); resolve(false); } };
    const onO = (e) => { if (e.target === overlay) { cleanup(); resolve(false); } };
    delBtn.addEventListener('click', onD); canBtn.addEventListener('click', onC);
    document.addEventListener('keydown', onK); overlay.addEventListener('click', onO);
  });
  if (ok) { try { await deleteDoc(doc(db, 'chats', chatId)); if (currentChatId === chatId) newChat(); await loadChatHistory(); } catch (e) { console.error(e); } }
};

window.loadChat = async function (chatId) {
  const chat = chatHistory.find(c => c.id === chatId);
  if (!chat) return;
  currentChatId = chatId; messages = chat.messages || []; currentModel = chat.model || 'llama-3.3-70b-versatile';
  isAdultContent = chat.isAdultContent || false;
  ageConfirmed = chat.ageConfirmed || false;
  const names = { 'llama-3.3-70b-versatile': 'LLaMA 3.3 70B Versatile', 'llama-3.1-8b-instant': 'LLaMA 3.1 8B Instant', 'compound-beta': 'Groq Compound Beta', 'openai/gpt-oss-120b': 'GPT OSS 120B', 'openai/gpt-oss-20b': 'GPT OSS 20B', 'groq/compound-mini': 'Groq Compound Mini', 'qwen/qwen3-32b': 'Qwen3 32B', 'moonshotai/kimi-k2-instruct-0905': 'Kimi K2' };
  document.getElementById('selectedModel').textContent = names[currentModel] || 'LLaMA 3.3 70B Versatile';
  document.querySelectorAll('.model-option').forEach(o => o.classList.toggle('selected', o.getAttribute('data-value') === currentModel));
  if (typeof window.loadChatWithImages === 'function') {
    window.loadChatWithImages(chat, addMessageToUI);
  } else {
    document.getElementById('chatContainer').innerHTML = '';
    messages.forEach(m => { if (m.role === 'user') addMessageToUI(m.content, 'user'); else if (m.role === 'assistant') { const { clean } = extractAndStripMemory(m.content); addMessageToUI(clean, 'ai'); } });
  }
  updateHistoryList();
  updateBotSelectorState();
  if (isAdultContent && !ageConfirmed) {
    showAgeConfirm();
  }
};

async function saveCurrentChat() {
  if (!currentUser || messages.length === 0) return;
  try {
    const firstContent = messages[0]?.content;
    const firstText = typeof firstContent === 'string' ? firstContent : (Array.isArray(firstContent) ? (firstContent.find(c => c.type === 'text')?.text || 'Image Message') : 'New Chat');
    let title = firstText.substring(0, 50);
    if (currentCharacter) {
      title = `Chatting with ${currentCharacter.name}`;
    } else if (!currentChatId && messages.length >= 1) {
      title = await generateChatTitle();
    }

    const messagesForStorage = messages.map(m => {
      if (m.type === 'image' && m.imageBase64) {
        return { ...m, imageBase64: '[IMAGE_DATA]', _hasImage: true };
      }
      if (Array.isArray(m.content)) {
        const textPart = m.content.find(c => c.type === 'text')?.text || '';
        const imgPart  = m.content.find(c => c.type === 'image_url');
        const imgUrl   = imgPart?.image_url?.url || null;
        const safeImgUrl = imgUrl && imgUrl.startsWith('data:') ? '[IMAGE_DATA]' : imgUrl;
        return {
          ...m,
          content: [
            { type: 'text', text: textPart },
            ...(safeImgUrl ? [{ type: 'image_url', image_url: { url: safeImgUrl }, _originalUrl: true }] : [])
          ]
        };
      }
      return m;
    });

    const data = { userId: currentUser.uid, title, messages: messagesForStorage, model: currentModel, isAdultContent, ageConfirmed, updatedAt: serverTimestamp() };
    if (currentChatId) { await updateDoc(doc(db, 'chats', currentChatId), data); }
    else { const ref = await addDoc(collection(db, 'chats'), { ...data, createdAt: serverTimestamp() }); currentChatId = ref.id; }
    await loadChatHistory();
  } catch (e) { console.error('Error saving chat:', e); }
}

window.newChat = async function () {
  currentChatId = null; messages = [];
  isAdultContent = false;
  ageConfirmed = false;
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  const data = snap.exists() ? snap.data() : {};
  const name = (data.displayName || currentUser.displayName || currentUser.email).split(' ')[0];
  const cc = document.getElementById('chatContainer');
  if (aiRecommendations.length === 0) {
    cc.innerHTML = `<div class="welcome-screen"><div class="welcome-title">Welcome to Snyaptium, ${name}</div><div class="welcome-subtitle">Your intelligent AI companion ready to assist with any task.</div><div class="suggestion-cards">${['','','',''].map(() => '<div class="suggestion-card generating"><div class="suggestion-card-title">Generating...</div><div class="suggestion-card-text">AI is creating suggestions</div></div>').join('')}</div></div>`;
  } else {
    cc.innerHTML = `<div class="welcome-screen"><div class="welcome-title">Welcome to Snyaptium, ${name}</div><div class="welcome-subtitle">Your intelligent AI companion ready to assist with any task.</div><div class="suggestion-cards">${aiRecommendations.map((s, i) => `<div class="suggestion-card loaded" style="animation-delay:${i*0.1}s" onclick="useSuggestion('${s.prompt.replace(/'/g,"\\'")}')"><div class="suggestion-card-title">${s.title}</div><div class="suggestion-card-text">${s.text}</div></div>`).join('')}</div></div>`;
  }
  updateHistoryList();
  updateBotSelectorState();
  if (window.innerWidth <= 768) { document.querySelector('.sidebar')?.classList.remove('mobile-open'); document.querySelector('.mobile-sidebar-overlay')?.classList.remove('active'); }
};

function initCustomDropdown() {
  const cs = document.getElementById('customSelect'), mo = document.getElementById('modelOverlay'), sm = document.getElementById('selectedModel'), opts = document.querySelectorAll('.model-option');
  cs.addEventListener('click', (e) => { e.stopPropagation(); mo.classList.add('active'); });
  mo.addEventListener('click', (e) => { if (e.target === mo) mo.classList.remove('active'); });
  opts.forEach(o => { o.addEventListener('click', (e) => { e.stopPropagation(); opts.forEach(x => x.classList.remove('selected')); o.classList.add('selected'); sm.textContent = o.querySelector('.model-option-name').textContent; currentModel = o.getAttribute('data-value'); mo.classList.remove('active'); addSystemMessage(`Model changed to ${sm.textContent}`); }); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { mo.classList.remove('active'); document.getElementById('botOverlay')?.classList.remove('active'); } });
}

function initBotSelector() {
  const bs = document.getElementById('botSelect'), bo = document.getElementById('botOverlay');
  if (!bs || !bo) return;
  bs.addEventListener('click', (e) => { if (messages.length === 0) { e.stopPropagation(); bo.classList.add('active'); } });
  bo.addEventListener('click', (e) => { if (e.target === bo) bo.classList.remove('active'); });
  document.querySelector('.bot-option[data-bot-id=""]')?.addEventListener('click', () => selectCharacter(null));

  document.getElementById('ageConfirmCancel')?.addEventListener('click', window.cancelAgeConfirm);
  document.getElementById('ageConfirmConfirm')?.addEventListener('click', window.confirmAge);
}

function updateBotSelectorState() {
  const bs = document.getElementById('botSelect');
  if (!bs) return;
  if (messages.length > 0) {
    bs.style.opacity = '0.5';
    bs.style.pointerEvents = 'none';
  } else {
    bs.style.opacity = '1';
    bs.style.pointerEvents = 'auto';
  }
}

async function checkAdultContent(text) {
  console.log('checkAdultContent called with text length:', text.length);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a content moderator. Analyze the given text for adult/NSFW content. Respond with ONLY "ADULT" if the content contains adult/NSFW material (sexual content, explicit violence, etc.) or "SAFE" if it is safe. No other text.'
          },
          {
            role: 'user',
            content: text
          }
        ],
        max_tokens: 10,
        temperature: 0.1
      })
    });
    console.log('Adult content check response status:', response.status);
    const data = await response.json();
    console.log('Adult content check response data:', data);
    const result = data.choices?.[0]?.message?.content?.trim().toUpperCase();
    console.log('Adult content check result:', result);
    return result === 'ADULT';
  } catch (e) {
    console.error('Error checking adult content:', e);
    return false;
  }
}

function showAgeConfirm() {
  document.getElementById('ageConfirmOverlay').classList.add('active');
}

function hideAgeConfirm() {
  document.getElementById('ageConfirmOverlay').classList.remove('active');
}

window.confirmAge = async function() {
  ageConfirmed = true;
  isAdultContent = true;
  hideAgeConfirm();
  await saveAgeConfirmation();
};

window.cancelAgeConfirm = function() {
  hideAgeConfirm();
  newChat();
};

async function saveAgeConfirmation() {
  if (!currentChatId || !currentUser) return;
  try {
    await updateDoc(doc(db, 'chats', currentChatId), {
      isAdultContent: true,
      ageConfirmed: true,
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    console.error('Error saving age confirmation:', e);
  }
}

window.useSuggestion = (text) => { document.getElementById('userInput').value = text; sendMessage(); };
window.autoResize    = (el) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px'; };
window.handleKeyPress = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

function hideWelcomeScreen() { document.querySelector('.welcome-screen')?.remove(); }

function addMessageToUI(content, type) {
  console.log('addMessageToUI called with type:', type, 'content length:', content.length);
  console.log('addMessageToUI content preview:', content.substring(0, 100));
  hideWelcomeScreen();
  const cc = document.getElementById('chatContainer');
  const w  = document.createElement('div'); w.className = `message-wrapper ${type}`;
  const av = document.createElement('div'); av.className = `avatar ${type}`;
  if (type === 'user') {
    if (userProfilePic) { av.classList.add('has-image'); const img = document.createElement('img'); img.src = userProfilePic; img.alt = 'User'; av.appendChild(img); }
    else { av.textContent = (currentUser.displayName || currentUser.email || 'U')[0].toUpperCase(); }
  } else { const img = document.createElement('img'); img.src = 'img/logo.png'; img.alt = 'AI'; av.appendChild(img); }
  const mc = document.createElement('div'); mc.className = 'message-content';
  if (type === 'ai') {
    mc.innerHTML = marked.parse(content);
    
    // Use MutationObserver to continuously clean memory JSON during/after streaming
    const observer = new MutationObserver(() => {
      const memoryPattern = /\[MEMORY:\s*\{[^}]*\}\s*\]/g;
      if (memoryPattern.test(mc.innerHTML)) {
        mc.innerHTML = mc.innerHTML.replace(memoryPattern, '');
        console.log('Memory JSON removed from DOM via MutationObserver');
      }
    });
    observer.observe(mc, { childList: true, subtree: true });
    
    // Stop observing after 3 seconds
    setTimeout(() => observer.disconnect(), 3000);
    
    const sb = document.createElement('button'); sb.className = 'speaker-btn'; sb.innerHTML = '<i class="fas fa-volume-up"></i> Listen'; sb.onclick = () => speakText(content, sb); mc.appendChild(sb);
    setTimeout(() => { if (typeof window.detectAndCreateArtifacts === 'function') window.detectAndCreateArtifacts(mc); }, 100);
  } else { mc.textContent = content; }
  w.appendChild(av); w.appendChild(mc); cc.appendChild(w); cc.scrollTop = cc.scrollHeight;
  updateBotSelectorState();
}

function addSystemMessage(content) {
  hideWelcomeScreen();
  const cc = document.getElementById('chatContainer');
  const w  = document.createElement('div'); w.className = 'message-wrapper ai'; w.style.opacity = '0.6';
  const av = document.createElement('div'); av.className = 'avatar ai'; av.innerHTML = '<i class="fas fa-info-circle"></i>';
  const mc = document.createElement('div'); mc.className = 'message-content'; mc.textContent = content;
  w.appendChild(av); w.appendChild(mc); cc.appendChild(w); cc.scrollTop = cc.scrollHeight;
}

function showTypingIndicator() {
  hideWelcomeScreen();
  const cc = document.getElementById('chatContainer');
  const w  = document.createElement('div'); w.className = 'message-wrapper ai'; w.id = 'typingIndicator';
  const av = document.createElement('div'); av.className = 'avatar ai'; const img = document.createElement('img'); img.src = 'img/logo.png'; img.alt = 'AI'; av.appendChild(img);
  const td = document.createElement('div'); td.className = 'typing-indicator'; td.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  w.appendChild(av); w.appendChild(td); cc.appendChild(w); cc.scrollTop = cc.scrollHeight;
}

function hideTypingIndicator() { document.getElementById('typingIndicator')?.remove(); }

window.sendMessage = async function () {
  console.log('sendMessage called');
  const input   = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const msg     = input.value.trim();
  if (!msg && !pendingImage) return;

  if (pendingImage) {
    const imageSnapshot = { ...pendingImage };
    const textMsg = msg || 'What is in this image?';
    clearPendingImage();
    input.value = ''; input.style.height = 'auto'; input.disabled = true; sendBtn.disabled = true;

    addMessageToUIWithImage(msg, imageSnapshot.previewUrl, 'user');

    const visionContent = [
      { type: 'text', text: textMsg },
      { type: 'image_url', image_url: { url: `data:${imageSnapshot.mimeType};base64,${imageSnapshot.base64}` } }
    ];
    messages.push({ role: 'user', content: visionContent });
    showTypingIndicator();

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [buildSystemPrompt(), ...messages], temperature: 0.7, max_tokens: 1024 })
      });
      if (!res.ok) throw new Error('Vision API request failed');
      const raw = (await res.json()).choices[0].message.content;
      const { clean, entry } = extractAndStripMemory(raw);
      hideTypingIndicator();
      addMessageToUI(clean, 'ai');
      messages.push({ role: 'assistant', content: clean });
      if (entry?.key && entry?.value) await saveMemoryEntry(entry.key, entry.value);

      const isAdult = await checkAdultContent(clean);
      console.log('Vision AI response adult check result:', isAdult);
      if (isAdult && !ageConfirmed) {
        isAdultContent = true;
        showAgeConfirm();
      }

      await saveCurrentChat();
    } catch (e) {
      hideTypingIndicator();
      addMessageToUI('Sorry, I couldn\'t process that image. Please try again.', 'ai');
      console.error(e);
    } finally {
      input.disabled = false; sendBtn.disabled = false; input.focus();
    }
    return;
  }

  if (typeof window.sendMessageWithImageGen === 'function') {
    const wrappedAddMessage = (content, type) => {
      console.log('wrappedAddMessage called with type:', type, 'content length:', content.length);
      if (type === 'ai') {
        const { clean, entry } = extractAndStripMemory(content);
        console.log('After stripMemory - clean length:', clean.length, 'entry:', entry);
        if (entry?.key && entry?.value) saveMemoryEntry(entry.key, entry.value);
        
        // Update the last message in messages array with cleaned text
        if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
          messages[messages.length - 1].content = clean;
          console.log('Updated messages array with cleaned text');
        }
        
        addMessageToUI(clean, type);

        checkAdultContent(clean).then(isAdult => {
          console.log('Image gen AI response adult check result:', isAdult);
          if (isAdult && !ageConfirmed) {
            isAdultContent = true;
            showAgeConfirm();
          }
        });
      } else {
        addMessageToUI(content, type);
      }
    };
    
    // Intercept and clean the response before it's processed
    const originalSaveChat = saveCurrentChat;
    const interceptedSaveChat = async () => {
      // Clean all assistant messages before saving
      messages.forEach(m => {
        if (m.role === 'assistant' && typeof m.content === 'string') {
          const { clean } = extractAndStripMemory(m.content);
          m.content = clean;
        }
      });
      await originalSaveChat();
    };
    
    await window.sendMessageWithImageGen(API_KEY, API_URL, currentUser, messages, currentModel, buildSystemPrompt(), interceptedSaveChat, wrappedAddMessage, hideTypingIndicator, showTypingIndicator);
    return;
  }

  addMessageToUI(msg, 'user');
  messages.push({ role: 'user', content: msg });
  input.value = ''; input.style.height = 'auto'; input.disabled = true; sendBtn.disabled = true;
  showTypingIndicator();

  const isUserAdult = await checkAdultContent(msg);
  console.log('User message adult check result:', isUserAdult);
  if (isUserAdult && !ageConfirmed) {
    isAdultContent = true;
    showAgeConfirm();
  }

  const sanitizedMsgs = messages.map(m => ({
    ...m,
    content: Array.isArray(m.content)
      ? (m.content.find(c => c.type === 'text')?.text || '[Image message]')
      : m.content
  }));

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: currentModel, messages: [buildSystemPrompt(), ...sanitizedMsgs], temperature: 0.7, max_tokens: 1024, stream: true })
    });
    if (!res.ok) throw new Error('API request failed');

    hideTypingIndicator();

    const cc = document.getElementById('chatContainer');
    const w  = document.createElement('div'); w.className = 'message-wrapper ai';
    const av = document.createElement('div'); av.className = 'avatar ai';
    const avImg = document.createElement('img'); avImg.src = 'img/logo.png'; avImg.alt = 'AI'; av.appendChild(avImg);
    const mc = document.createElement('div'); mc.className = 'message-content streaming';
    w.appendChild(av); w.appendChild(mc); cc.appendChild(w);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    let adultDetected = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) {
            raw += delta;
            const { clean: liveClean } = extractAndStripMemory(raw);
            mc.innerHTML = marked.parse(liveClean);
            cc.scrollTop = cc.scrollHeight;
            await new Promise(r => setTimeout(r, 18));

            // Check for adult content during streaming
            if (!adultDetected && liveClean.length > 50) {
              const isAdult = await checkAdultContent(liveClean);
              if (isAdult) {
                adultDetected = true;
                console.log('Adult content detected during streaming');
                reader.cancel(); // Stop the stream
                if (!ageConfirmed) {
                  isAdultContent = true;
                  showAgeConfirm();
                }
                // Exit immediately without continuing
                hideTypingIndicator();
                input.disabled = false; sendBtn.disabled = false; input.focus();
                return;
              }
            }
          }
        } catch (_) {}
      }
      if (adultDetected) break;
    }

    mc.classList.remove('streaming');
    const { clean, entry } = extractAndStripMemory(raw);
    mc.innerHTML = marked.parse(clean);

    if (entry?.key && entry?.value) {
      const chip = document.createElement('div');
      chip.className = 'memory-chip';
      chip.innerHTML = `<i class="fas fa-brain"></i> <span>Memory saved: <strong>${entry.value}</strong></span>`;
      mc.appendChild(chip);
    }

    const sb = document.createElement('button');
    sb.className = 'speaker-btn';
    sb.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
    sb.onclick = () => speakText(clean, sb);
    mc.appendChild(sb);
    setTimeout(() => { if (typeof window.detectAndCreateArtifacts === 'function') window.detectAndCreateArtifacts(mc); }, 100);

    const isAdult = await checkAdultContent(clean);
    console.log('Streaming AI response adult check result:', isAdult);
    if (isAdult && !ageConfirmed) {
      isAdultContent = true;
      showAgeConfirm();
    }

    messages.push({ role: 'assistant', content: clean });
    if (entry?.key && entry?.value) await saveMemoryEntry(entry.key, entry.value);
    await saveCurrentChat();

  } catch (e) {
    hideTypingIndicator();
    addMessageToUI('Sorry, I encountered an error. Please try again.', 'ai');
    console.error(e);
  } finally {
    input.disabled = false; sendBtn.disabled = false; input.focus();
  }
};

async function generateRecommendations() {
  if (isGeneratingRecommendations) return;
  isGeneratingRecommendations = true;
  try {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` }, body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'Generate 4 creative and diverse conversation starter suggestions for an AI chat interface. Each suggestion should have a short title (2-4 words), a brief description (4-6 words), and a specific example prompt. Format your response as JSON array with objects containing "title", "text", and "prompt" fields. Make them varied across different topics like coding, writing, learning, productivity, creativity, etc. Only respond with the JSON array, nothing else.' }], temperature: 0.9, max_tokens: 500 }) });
    if (!res.ok) throw new Error();
    const content = (await res.json()).choices[0].message.content;
    const match   = content.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length >= 4) {
        aiRecommendations = parsed.slice(0, 4);
        if (document.querySelector('.welcome-screen') && messages.length === 0) {
          document.querySelectorAll('.suggestion-card.generating').forEach((c, i) => { setTimeout(() => { c.style.transition = 'opacity .3s, transform .3s'; c.style.opacity = '0'; c.style.transform = 'scale(0.95)'; }, i * 50); });
          setTimeout(() => newChat(), 300);
        }
      }
    }
  } catch (_) {} finally { isGeneratingRecommendations = false; }
}

async function generateChatTitle() {
  try {
    const rawU = messages.find(m => m.role === 'user')?.content;
    const u = typeof rawU === 'string' ? rawU : (Array.isArray(rawU) ? (rawU.find(c => c.type === 'text')?.text || 'Image message') : '');
    const a = messages.find(m => m.role === 'assistant')?.content || '';
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` }, body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: `Generate a short, descriptive title (3-6 words max) for a chat conversation that started with:\nUser: "${u.substring(0,200)}"\nAssistant: "${a.substring(0,200)}"\n\nOnly respond with the title, nothing else. No quotes or punctuation at the end.` }], temperature: 0.7, max_tokens: 30 }) });
    if (!res.ok) throw new Error();
    return (await res.json()).choices[0].message.content.trim().replace(/^["']|["']$/g,'').replace(/[.!?]$/,'').substring(0,50) || messages[0]?.content?.substring(0,50) || 'New Chat';
  } catch (_) { return messages[0]?.content?.substring(0,50) || 'New Chat'; }
}

window.toggleVoiceInput = function () {
  if (!recognition) { alert('Speech recognition is not supported in your browser.'); return; }
  if (isListening) {
    recognition.abort();
    stopVoiceInput();
  } else {
    try {
      recognition.start();
      isListening = true;
      const b = document.getElementById('voiceInputBtn');
      b.classList.add('listening');
      b.innerHTML = '<i class="fas fa-stop"></i>';
    } catch (e) {
      stopVoiceInput();
    }
  }
};

function stopVoiceInput() { isListening = false; const b = document.getElementById('voiceInputBtn'); b.classList.remove('listening'); b.innerHTML = '<i class="fas fa-microphone"></i>'; }

window.speakText = async function (text, button) {
  const wasThisButtonPlaying = button.classList.contains('playing');

  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    document.querySelectorAll('.speaker-btn.playing').forEach(b => {
      b.classList.remove('playing');
      b.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
    });
  }

  if (wasThisButtonPlaying) return;

  const clean = text
    .replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '').replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s/gm, '').trim();

  button.classList.add('playing');
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'canopylabs/orpheus-v1-english',
        input: clean,
        voice: currentVoice,
        response_format: 'wav'
      })
    });

    if (res.ok) {
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      button.innerHTML = '<i class="fas fa-stop"></i> Stop';

      audio.play();
      audio.onended = audio.onerror = () => {
        button.classList.remove('playing');
        button.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
        URL.revokeObjectURL(url);
        currentAudio = null;
      };
      return;
    }
    const errText = await res.text();
    console.error('Groq TTS error response:', res.status, errText);
    throw new Error('Groq TTS failed');

  } catch (e) {
    console.warn('Groq TTS failed, falling back to browser TTS:', e);
    button.innerHTML = '<i class="fas fa-stop"></i> Stop';
    button.classList.add('playing');
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1; u.pitch = 1; u.volume = 1;
    u.onend = u.onerror = () => {
      button.classList.remove('playing');
      button.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
      currentAudio = null;
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    currentAudio = { pause: () => window.speechSynthesis.cancel() };
  }
};

window.toggleSidebar = function () {
  const s = document.querySelector('.sidebar'), b = document.querySelector('.sidebar-toggle-btn');
  s.classList.toggle('collapsed');
  b.querySelector('i').className = s.classList.contains('collapsed') ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
};

window.addEventListener('resize', () => { if (window.innerWidth <= 768 && !document.querySelector('.mobile-header')) initMobileUI(); });