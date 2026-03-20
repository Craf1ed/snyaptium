import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, doc, getDocs, query, where, deleteDoc, serverTimestamp, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const FIREBASE_WORKER_URL = 'https://snyaptium-firebase.craftedgamz.workers.dev';
const AI_KEY_WORKER_URL   = 'https://snyaptium-ai.craftedgamz.workers.dev';

let firebaseConfig;
let API_KEY;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

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
let recognition    = null;
let isListening    = false;
let currentAudio   = null;

function buildSystemPrompt() {
  let content = 'You are Snyaptium AI, an intelligent and helpful AI assistant created by Snyaptium. You are designed to assist users with a wide variety of tasks including answering questions, writing, coding, analysis, creative tasks, and more. You are knowledgeable, friendly, and professional. Always strive to provide accurate, helpful, and comprehensive responses.';

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
  const match = text.match(/\[MEMORY:(\{[^}]+\})\][\s\r\n]*/);
  if (!match) return { clean: text, entry: null };
  let entry = null;
  try { entry = JSON.parse(match[1]); } catch (_) {}
  return { clean: text.slice(0, match.index).trimEnd(), entry };
}

window.extractAndStripMemory = extractAndStripMemory;
window.saveMemoryEntry = saveMemoryEntry;

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
    initSpeechRecognition();
    await loadChatHistory();
    initCustomDropdown();
    initMobileUI();
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('mainApp').style.display       = 'flex';
    setTimeout(generateRecommendations, 1000);
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
  const names = { 'llama-3.3-70b-versatile': 'LLaMA 3.3 70B Versatile', 'llama-3.1-8b-instant': 'LLaMA 3.1 8B Instant', 'compound-beta': 'Groq Compound Beta', 'openai/gpt-oss-120b': 'GPT OSS 120B', 'openai/gpt-oss-20b': 'GPT OSS 20B' };
  document.getElementById('selectedModel').textContent = names[currentModel] || 'LLaMA 3.3 70B Versatile';
  document.querySelectorAll('.model-option').forEach(o => o.classList.toggle('selected', o.getAttribute('data-value') === currentModel));
  if (typeof window.loadChatWithImages === 'function') {
    window.loadChatWithImages(chat, addMessageToUI);
  } else {
    document.getElementById('chatContainer').innerHTML = '';
    messages.forEach(m => { if (m.role === 'user') addMessageToUI(m.content, 'user'); else if (m.role === 'assistant') addMessageToUI(m.content, 'ai'); });
  }
  updateHistoryList();
};

async function saveCurrentChat() {
  if (!currentUser || messages.length === 0) return;
  try {
    let title = messages[0]?.content?.substring(0, 50) || 'New Chat';
    if (!currentChatId && messages.length >= 2) title = await generateChatTitle();
    const data = { userId: currentUser.uid, title, messages, model: currentModel, updatedAt: serverTimestamp() };
    if (currentChatId) { await updateDoc(doc(db, 'chats', currentChatId), data); }
    else { const ref = await addDoc(collection(db, 'chats'), { ...data, createdAt: serverTimestamp() }); currentChatId = ref.id; }
    await loadChatHistory();
  } catch (e) { console.error('Error saving chat:', e); }
}

window.newChat = async function () {
  currentChatId = null; messages = [];
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
  if (window.innerWidth <= 768) { document.querySelector('.sidebar')?.classList.remove('mobile-open'); document.querySelector('.mobile-sidebar-overlay')?.classList.remove('active'); }
};

function initCustomDropdown() {
  const cs = document.getElementById('customSelect'), mo = document.getElementById('modelOverlay'), sm = document.getElementById('selectedModel'), opts = document.querySelectorAll('.model-option');
  cs.addEventListener('click', (e) => { e.stopPropagation(); mo.classList.add('active'); });
  mo.addEventListener('click', (e) => { if (e.target === mo) mo.classList.remove('active'); });
  opts.forEach(o => { o.addEventListener('click', (e) => { e.stopPropagation(); opts.forEach(x => x.classList.remove('selected')); o.classList.add('selected'); sm.textContent = o.querySelector('.model-option-name').textContent; currentModel = o.getAttribute('data-value'); mo.classList.remove('active'); addSystemMessage(`Model changed to ${sm.textContent}`); }); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') mo.classList.remove('active'); });
}

window.useSuggestion = (text) => { document.getElementById('userInput').value = text; sendMessage(); };
window.autoResize    = (el) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px'; };
window.handleKeyPress = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

function hideWelcomeScreen() { document.querySelector('.welcome-screen')?.remove(); }

function addMessageToUI(content, type) {
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
    const sb = document.createElement('button'); sb.className = 'speaker-btn'; sb.innerHTML = '<i class="fas fa-volume-up"></i> Listen'; sb.onclick = () => speakText(content, sb); mc.appendChild(sb);
    setTimeout(() => { if (typeof window.detectAndCreateArtifacts === 'function') window.detectAndCreateArtifacts(mc); }, 100);
  } else { mc.textContent = content; }
  w.appendChild(av); w.appendChild(mc); cc.appendChild(w); cc.scrollTop = cc.scrollHeight;
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
  const input   = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const msg     = input.value.trim();
  if (!msg) return;

  if (typeof window.sendMessageWithImageGen === 'function') {
    const wrappedAddMessage = (content, type) => {
      if (type === 'ai') {
        const { clean, entry } = extractAndStripMemory(content);
        if (entry?.key && entry?.value) saveMemoryEntry(entry.key, entry.value);
        addMessageToUI(clean, type);
      } else {
        addMessageToUI(content, type);
      }
    };
    await window.sendMessageWithImageGen(API_KEY, API_URL, currentUser, messages, currentModel, buildSystemPrompt(), saveCurrentChat, wrappedAddMessage, hideTypingIndicator, showTypingIndicator);
    return;
  }

  addMessageToUI(msg, 'user');
  messages.push({ role: 'user', content: msg });
  input.value = ''; input.style.height = 'auto'; input.disabled = true; sendBtn.disabled = true;
  showTypingIndicator();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: currentModel, messages: [buildSystemPrompt(), ...messages], temperature: 0.7, max_tokens: 1024 })
    });
    if (!res.ok) throw new Error('API request failed');
    const raw = (await res.json()).choices[0].message.content;
    const { clean, entry } = extractAndStripMemory(raw);
    hideTypingIndicator();
    addMessageToUI(clean, 'ai');
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
    const u = messages.find(m => m.role === 'user')?.content || '';
    const a = messages.find(m => m.role === 'assistant')?.content || '';
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` }, body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: `Generate a short, descriptive title (3-6 words max) for a chat conversation that started with:\nUser: "${u.substring(0,200)}"\nAssistant: "${a.substring(0,200)}"\n\nOnly respond with the title, nothing else. No quotes or punctuation at the end.` }], temperature: 0.7, max_tokens: 30 }) });
    if (!res.ok) throw new Error();
    return (await res.json()).choices[0].message.content.trim().replace(/^["']|["']$/g,'').replace(/[.!?]$/,'').substring(0,50) || messages[0]?.content?.substring(0,50) || 'New Chat';
  } catch (_) { return messages[0]?.content?.substring(0,50) || 'New Chat'; }
}

window.toggleVoiceInput = function () {
  if (!recognition) { alert('Speech recognition is not supported in your browser.'); return; }
  if (isListening) { recognition.stop(); stopVoiceInput(); } else { recognition.start(); isListening = true; const b = document.getElementById('voiceInputBtn'); b.classList.add('listening'); b.innerHTML = '<i class="fas fa-stop"></i>'; }
};

function stopVoiceInput() { isListening = false; const b = document.getElementById('voiceInputBtn'); b.classList.remove('listening'); b.innerHTML = '<i class="fas fa-microphone"></i>'; }

window.speakText = function (text, button) {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; document.querySelectorAll('.speaker-btn.playing').forEach(b => { b.classList.remove('playing'); b.innerHTML = '<i class="fas fa-volume-up"></i> Listen'; }); }
  if (button.classList.contains('playing')) { button.classList.remove('playing'); button.innerHTML = '<i class="fas fa-volume-up"></i> Listen'; return; }
  const clean = text.replace(/#{1,6}\s/g,'').replace(/\*\*/g,'').replace(/\*/g,'').replace(/`{1,3}[^`]*`{1,3}/g,'').replace(/\[([^\]]+)\]\([^\)]+\)/g,'$1').replace(/^\s*[-*+]\s/gm,'').trim();
  if (!('speechSynthesis' in window)) { alert('Text-to-speech is not supported in your browser.'); return; }
  const u = new SpeechSynthesisUtterance(clean); u.rate = 1; u.pitch = 1; u.volume = 1;
  button.classList.add('playing'); button.innerHTML = '<i class="fas fa-stop"></i> Stop';
  u.onend = u.onerror = () => { button.classList.remove('playing'); button.innerHTML = '<i class="fas fa-volume-up"></i> Listen'; currentAudio = null; };
  window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  currentAudio = { pause: () => window.speechSynthesis.cancel() };
};

window.toggleSidebar = function () {
  const s = document.querySelector('.sidebar'), b = document.querySelector('.sidebar-toggle-btn');
  s.classList.toggle('collapsed');
  b.querySelector('i').className = s.classList.contains('collapsed') ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
};

window.addEventListener('resize', () => { if (window.innerWidth <= 768 && !document.querySelector('.mobile-header')) initMobileUI(); });