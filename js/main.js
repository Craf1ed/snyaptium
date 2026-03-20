import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, doc, getDocs, query, where, deleteDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const FIREBASE_WORKER_URL = 'https://snyaptium-firebase.craftedgamz.workers.dev';
const AI_KEY_WORKER_URL   = 'https://snyaptium-ai.craftedgamz.workers.dev';

let firebaseConfig;
let API_KEY;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function loadEnv() {
  try {
    const [firebaseRes, aiRes] = await Promise.all([
      fetch(FIREBASE_WORKER_URL, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'snyaptium-firebase' }
      }),
      fetch(AI_KEY_WORKER_URL, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'snyaptium-ai' }
      })
    ]);

    if (!firebaseRes.ok || !aiRes.ok) throw new Error('Failed to load configuration');

    const firebaseData = await firebaseRes.json();
    const aiData       = await aiRes.json();
    firebaseConfig = firebaseData.firebaseConfig;
    API_KEY        = aiData.apiKey;
    console.log('✅ Environment loaded successfully');
  } catch (error) {
    console.error('❌ Error loading environment:', error);
    throw error;
  }
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
let aiRecommendations        = [];
let isGeneratingRecommendations = false;
let userProfilePic = null;
let recognition    = null;
let isListening    = false;
let currentAudio   = null;

const SYSTEM_PROMPT = {
  role: 'system',
  content: 'You are Snyaptium AI, an intelligent and helpful AI assistant created by Snyaptium. You are designed to assist users with a wide variety of tasks including answering questions, writing, coding, analysis, creative tasks, and more. You are knowledgeable, friendly, and professional. Always strive to provide accurate, helpful, and comprehensive responses.'
};

/* ── Speech recognition ──────────────────────────────────── */
function initSpeechRecognition() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous     = false;
    recognition.interimResults = false;
    recognition.lang           = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      document.getElementById('userInput').value = transcript;
      autoResize(document.getElementById('userInput'));
    };
    recognition.onerror = () => stopVoiceInput();
    recognition.onend   = () => stopVoiceInput();
  }
}

/* ── Mobile UI ───────────────────────────────────────────── */
function initMobileUI() {
  if (window.innerWidth > 768) return;
  if (document.querySelector('.mobile-header')) return;

  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    const mobileHeader = document.createElement('div');
    mobileHeader.className = 'mobile-header';
    mobileHeader.innerHTML = `
      <button class="mobile-menu-btn" onclick="toggleMobileSidebar()">
        <i class="fas fa-bars"></i>
      </button>
      <div class="mobile-logo">Snyaptium</div>
      <button class="mobile-new-chat-btn" onclick="newChat()">
        <i class="fas fa-plus"></i>
      </button>
    `;
    mainContent.insertBefore(mobileHeader, mainContent.firstChild);
  }

  if (!document.querySelector('.mobile-sidebar-overlay')) {
    const overlay = document.createElement('div');
    overlay.className = 'mobile-sidebar-overlay';
    overlay.onclick   = () => toggleMobileSidebar();
    document.body.appendChild(overlay);
  }
}

window.toggleMobileSidebar = function () {
  document.querySelector('.sidebar')?.classList.toggle('mobile-open');
  document.querySelector('.mobile-sidebar-overlay')?.classList.toggle('active');
};

/* ── Auth ────────────────────────────────────────────────── */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;

    try {
      await loadUserProfile();
      initSpeechRecognition();
      await loadChatHistory();
      initCustomDropdown();
      initMobileUI();

      document.getElementById('loadingScreen').style.display = 'none';
      document.getElementById('mainApp').style.display       = 'flex';

      setTimeout(generateRecommendations, 1000);
    } catch (error) {
      console.error('❌ Error during initialization:', error);
      alert('Error loading app. Please refresh the page.');
    }
  } else {
    window.location.href = 'signup.html';
  }
});

/* ── User profile ────────────────────────────────────────── */
async function loadUserProfile() {
  try {
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    const userData = userDoc.exists() ? userDoc.data() : {};

    const displayName = userData.displayName || currentUser.displayName || currentUser.email;
    userProfilePic    = userData.profilePicURL || null;

    document.getElementById('userName').textContent      = displayName;
    document.getElementById('welcomeTitle').textContent  = `Welcome to Snyaptium, ${displayName.split(' ')[0]}`;
  } catch (error) {
    console.error('Error loading user profile:', error);
    document.getElementById('userName').textContent = currentUser.displayName || currentUser.email;
  }
}

/* ── Logout ──────────────────────────────────────────────── */
window.handleLogout = async function () {
  try {
    await signOut(auth);
    window.location.href = 'signup.html';
  } catch (error) {
    console.error('Logout error:', error);
  }
};

/* ── Chat history ────────────────────────────────────────── */
async function loadChatHistory() {
  try {
    const q = query(collection(db, 'chats'), where('userId', '==', currentUser.uid));
    const querySnapshot = await getDocs(q);
    chatHistory = [];
    querySnapshot.forEach((d) => chatHistory.push({ id: d.id, ...d.data() }));
    chatHistory.sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0));
    updateHistoryList();
    console.log(`✅ Loaded ${chatHistory.length} chats`);
  } catch (error) {
    console.error('Error loading chat history:', error);
  }
}

function updateHistoryList() {
  document.getElementById('historyList').innerHTML = chatHistory.map(chat => `
    <div class="history-item ${currentChatId === chat.id ? 'active' : ''}"
         onclick="loadChat('${chat.id}'); window.innerWidth <= 768 && toggleMobileSidebar();">
      <div class="history-item-title">${chat.title || 'New Chat'}</div>
      <button class="delete-chat-btn" onclick="event.stopPropagation(); deleteChat('${chat.id}')">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `).join('');
}

window.deleteChat = async function (chatId) {
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmDelete  = document.getElementById('confirmDelete');
  const confirmCancel  = document.getElementById('confirmCancel');

  confirmOverlay.classList.add('active');

  const userDecision = await new Promise((resolve) => {
    const cleanup = () => {
      confirmDelete.removeEventListener('click', onDel);
      confirmCancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      confirmOverlay.removeEventListener('click', onOverlay);
      confirmOverlay.classList.remove('active');
    };
    const onDel     = () => { cleanup(); resolve(true); };
    const onCancel  = () => { cleanup(); resolve(false); };
    const onKey     = (e) => { if (e.key === 'Escape') { cleanup(); resolve(false); } };
    const onOverlay = (e) => { if (e.target === confirmOverlay) { cleanup(); resolve(false); } };

    confirmDelete.addEventListener('click', onDel);
    confirmCancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
    confirmOverlay.addEventListener('click', onOverlay);
  });

  if (userDecision) {
    try {
      await deleteDoc(doc(db, 'chats', chatId));
      if (currentChatId === chatId) newChat();
      await loadChatHistory();
    } catch (error) {
      console.error('Error deleting chat:', error);
    }
  }
};

window.loadChat = async function (chatId) {
  const chat = chatHistory.find(c => c.id === chatId);
  if (!chat) return;

  currentChatId = chatId;
  messages      = chat.messages || [];
  currentModel  = chat.model || 'llama-3.3-70b-versatile';

  const modelNames = {
    'llama-3.3-70b-versatile': 'LLaMA 3.3 70B Versatile',
    'llama-3.1-8b-instant':    'LLaMA 3.1 8B Instant',
    'compound-beta':            'Groq Compound Beta',
    'openai/gpt-oss-120b':      'GPT OSS 120B',
    'openai/gpt-oss-20b':       'GPT OSS 20B'
  };
  document.getElementById('selectedModel').textContent = modelNames[currentModel] || 'LLaMA 3.3 70B Versatile';

  document.querySelectorAll('.model-option').forEach(opt => {
    opt.classList.toggle('selected', opt.getAttribute('data-value') === currentModel);
  });

  if (typeof window.loadChatWithImages === 'function') {
    window.loadChatWithImages(chat, addMessageToUI);
  } else {
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.innerHTML = '';
    messages.forEach(msg => {
      if (msg.role === 'user')      addMessageToUI(msg.content, 'user');
      else if (msg.role === 'assistant') addMessageToUI(msg.content, 'ai');
    });
  }
  updateHistoryList();
};

async function saveCurrentChat() {
  if (!currentUser || messages.length === 0) return;

  try {
    let chatTitle = messages[0]?.content?.substring(0, 50) || 'New Chat';
    if (!currentChatId && messages.length >= 2) chatTitle = await generateChatTitle();

    const chatData = {
      userId:    currentUser.uid,
      title:     chatTitle,
      messages:  messages,
      model:     currentModel,
      updatedAt: serverTimestamp()
    };

    if (currentChatId) {
      await updateDoc(doc(db, 'chats', currentChatId), chatData);
    } else {
      const docRef  = await addDoc(collection(db, 'chats'), { ...chatData, createdAt: serverTimestamp() });
      currentChatId = docRef.id;
    }
    await loadChatHistory();
  } catch (error) {
    console.error('Error saving chat:', error);
  }
}

/* ── New chat ────────────────────────────────────────────── */
window.newChat = async function () {
  currentChatId = null;
  messages      = [];

  const userDoc     = await getDoc(doc(db, 'users', currentUser.uid));
  const userData    = userDoc.exists() ? userDoc.data() : {};
  const displayName = userData.displayName || currentUser.displayName || currentUser.email;
  const firstName   = displayName.split(' ')[0];

  const chatContainer = document.getElementById('chatContainer');

  if (aiRecommendations.length === 0) {
    chatContainer.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-title">Welcome to Snyaptium, ${firstName}</div>
        <div class="welcome-subtitle">Your intelligent AI companion ready to assist with any task.</div>
        <div class="suggestion-cards">
          ${['','','',''].map(() => `
            <div class="suggestion-card generating">
              <div class="suggestion-card-title">Generating...</div>
              <div class="suggestion-card-text">AI is creating suggestions</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  } else {
    chatContainer.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-title">Welcome to Snyaptium, ${firstName}</div>
        <div class="welcome-subtitle">Your intelligent AI companion ready to assist with any task.</div>
        <div class="suggestion-cards">
          ${aiRecommendations.map((s, i) => `
            <div class="suggestion-card loaded" style="animation-delay:${i * 0.1}s"
                 onclick="useSuggestion('${s.prompt.replace(/'/g, "\\'")}')">
              <div class="suggestion-card-title">${s.title}</div>
              <div class="suggestion-card-text">${s.text}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  updateHistoryList();

  if (window.innerWidth <= 768) {
    document.querySelector('.sidebar')?.classList.remove('mobile-open');
    document.querySelector('.mobile-sidebar-overlay')?.classList.remove('active');
  }
};

/* ── Model dropdown ──────────────────────────────────────── */
function initCustomDropdown() {
  const customSelect  = document.getElementById('customSelect');
  const modelOverlay  = document.getElementById('modelOverlay');
  const selectedModel = document.getElementById('selectedModel');
  const modelOptions  = document.querySelectorAll('.model-option');

  customSelect.addEventListener('click', (e) => {
    e.stopPropagation();
    modelOverlay.classList.add('active');
  });

  modelOverlay.addEventListener('click', (e) => {
    if (e.target === modelOverlay) modelOverlay.classList.remove('active');
  });

  modelOptions.forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      modelOptions.forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
      selectedModel.textContent = option.querySelector('.model-option-name').textContent;
      currentModel = option.getAttribute('data-value');
      modelOverlay.classList.remove('active');
      addSystemMessage(`Model changed to ${selectedModel.textContent}`);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modelOverlay.classList.remove('active');
  });
}

/* ── UI helpers ──────────────────────────────────────────── */
window.useSuggestion = function (text) {
  document.getElementById('userInput').value = text;
  sendMessage();
};

window.autoResize = function (textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
};

window.handleKeyPress = function (event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
};

function hideWelcomeScreen() {
  document.querySelector('.welcome-screen')?.remove();
}

function addMessageToUI(content, type) {
  hideWelcomeScreen();
  const chatContainer = document.getElementById('chatContainer');
  const wrapper       = document.createElement('div');
  wrapper.className   = `message-wrapper ${type}`;

  const avatar      = document.createElement('div');
  avatar.className  = `avatar ${type}`;

  if (type === 'user') {
    if (userProfilePic) {
      avatar.classList.add('has-image');
      const img = document.createElement('img');
      img.src   = userProfilePic;
      img.alt   = 'User';
      avatar.appendChild(img);
    } else {
      avatar.textContent = (currentUser.displayName || currentUser.email || 'U')[0].toUpperCase();
    }
  } else {
    const img = document.createElement('img');
    img.src   = 'img/logo.png';
    img.alt   = 'AI';
    avatar.appendChild(img);
  }

  const messageContent      = document.createElement('div');
  messageContent.className  = 'message-content';

  if (type === 'ai') {
    messageContent.innerHTML = marked.parse(content);

    const speakerBtn     = document.createElement('button');
    speakerBtn.className = 'speaker-btn';
    speakerBtn.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
    speakerBtn.onclick   = () => speakText(content, speakerBtn);
    messageContent.appendChild(speakerBtn);

    setTimeout(() => {
      if (typeof window.detectAndCreateArtifacts === 'function') {
        window.detectAndCreateArtifacts(messageContent);
      }
    }, 100);
  } else {
    messageContent.textContent = content;
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(messageContent);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function addSystemMessage(content) {
  hideWelcomeScreen();
  const chatContainer = document.getElementById('chatContainer');
  const wrapper       = document.createElement('div');
  wrapper.className   = 'message-wrapper ai';
  wrapper.style.opacity = '0.6';

  const avatar      = document.createElement('div');
  avatar.className  = 'avatar ai';
  avatar.innerHTML  = '<i class="fas fa-info-circle"></i>';

  const messageContent      = document.createElement('div');
  messageContent.className  = 'message-content';
  messageContent.textContent = content;

  wrapper.appendChild(avatar);
  wrapper.appendChild(messageContent);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function showTypingIndicator() {
  hideWelcomeScreen();
  const chatContainer = document.getElementById('chatContainer');
  const wrapper       = document.createElement('div');
  wrapper.className   = 'message-wrapper ai';
  wrapper.id          = 'typingIndicator';

  const avatar      = document.createElement('div');
  avatar.className  = 'avatar ai';
  const img = document.createElement('img');
  img.src   = 'img/logo.png';
  img.alt   = 'AI';
  avatar.appendChild(img);

  const typingDiv      = document.createElement('div');
  typingDiv.className  = 'typing-indicator';
  typingDiv.innerHTML  = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';

  wrapper.appendChild(avatar);
  wrapper.appendChild(typingDiv);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function hideTypingIndicator() {
  document.getElementById('typingIndicator')?.remove();
}

/* ── Send message ────────────────────────────────────────── */
window.sendMessage = async function () {
  const input     = document.getElementById('userInput');
  const sendBtn   = document.getElementById('sendBtn');
  const userMessage = input.value.trim();
  if (!userMessage) return;

  if (typeof window.sendMessageWithImageGen === 'function') {
    await window.sendMessageWithImageGen(
      API_KEY, API_URL, currentUser, messages, currentModel,
      SYSTEM_PROMPT, saveCurrentChat, addMessageToUI,
      hideTypingIndicator, showTypingIndicator
    );
    return;
  }

  addMessageToUI(userMessage, 'user');
  messages.push({ role: 'user', content: userMessage });

  input.value          = '';
  input.style.height   = 'auto';
  input.disabled       = true;
  sendBtn.disabled     = true;

  showTypingIndicator();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model:       currentModel,
        messages:    [SYSTEM_PROMPT, ...messages],
        temperature: 0.7,
        max_tokens:  1024
      })
    });

    if (!response.ok) throw new Error('API request failed');

    const data      = await response.json();
    const aiMessage = data.choices[0].message.content;

    hideTypingIndicator();
    addMessageToUI(aiMessage, 'ai');
    messages.push({ role: 'assistant', content: aiMessage });
    await saveCurrentChat();
  } catch (error) {
    hideTypingIndicator();
    addMessageToUI('Sorry, I encountered an error. Please try again.', 'ai');
    console.error('Error:', error);
  } finally {
    input.disabled   = false;
    sendBtn.disabled = false;
    input.focus();
  }
};

/* ── Recommendations ─────────────────────────────────────── */
async function generateRecommendations() {
  if (isGeneratingRecommendations) return;
  isGeneratingRecommendations = true;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{
          role: 'user',
          content: 'Generate 4 creative and diverse conversation starter suggestions for an AI chat interface. Each suggestion should have a short title (2-4 words), a brief description (4-6 words), and a specific example prompt. Format your response as JSON array with objects containing "title", "text", and "prompt" fields. Make them varied across different topics like coding, writing, learning, productivity, creativity, etc. Only respond with the JSON array, nothing else.'
        }],
        temperature: 0.9,
        max_tokens:  500
      })
    });

    if (!response.ok) throw new Error('Failed to generate recommendations');

    const data    = await response.json();
    const content = data.choices[0].message.content;
    const match   = content.match(/\[[\s\S]*\]/);

    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length >= 4) {
        aiRecommendations = parsed.slice(0, 4);
        const welcomeScreen = document.querySelector('.welcome-screen');
        if (welcomeScreen && messages.length === 0) {
          document.querySelectorAll('.suggestion-card.generating').forEach((card, i) => {
            setTimeout(() => {
              card.style.transition = 'opacity .3s ease, transform .3s ease';
              card.style.opacity   = '0';
              card.style.transform = 'scale(0.95)';
            }, i * 50);
          });
          setTimeout(() => newChat(), 300);
        }
      }
    }
  } catch (error) {
    console.error('Error generating recommendations:', error);
  } finally {
    isGeneratingRecommendations = false;
  }
}

async function generateChatTitle() {
  try {
    const userMsg = messages.find(m => m.role === 'user')?.content || '';
    const aiMsg   = messages.find(m => m.role === 'assistant')?.content || '';

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{
          role: 'user',
          content: `Generate a short, descriptive title (3-6 words max) for a chat conversation that started with:\nUser: "${userMsg.substring(0, 200)}"\nAssistant: "${aiMsg.substring(0, 200)}"\n\nOnly respond with the title, nothing else. No quotes or punctuation at the end.`
        }],
        temperature: 0.7,
        max_tokens:  30
      })
    });

    if (!response.ok) throw new Error('Failed to generate title');

    const data = await response.json();
    let title  = data.choices[0].message.content.trim()
      .replace(/^["']|["']$/g, '')
      .replace(/[.!?]$/, '')
      .substring(0, 50);

    return title || messages[0]?.content?.substring(0, 50) || 'New Chat';
  } catch (error) {
    return messages[0]?.content?.substring(0, 50) || 'New Chat';
  }
}

/* ── Voice ───────────────────────────────────────────────── */
window.toggleVoiceInput = function () {
  if (!recognition) { alert('Speech recognition is not supported in your browser.'); return; }
  if (isListening) {
    recognition.stop();
    stopVoiceInput();
  } else {
    recognition.start();
    isListening = true;
    const btn = document.getElementById('voiceInputBtn');
    btn.classList.add('listening');
    btn.innerHTML = '<i class="fas fa-stop"></i>';
  }
};

function stopVoiceInput() {
  isListening = false;
  const btn = document.getElementById('voiceInputBtn');
  btn.classList.remove('listening');
  btn.innerHTML = '<i class="fas fa-microphone"></i>';
}

/* ── TTS ─────────────────────────────────────────────────── */
window.speakText = function (text, button) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    document.querySelectorAll('.speaker-btn.playing').forEach(btn => {
      btn.classList.remove('playing');
      btn.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
    });
  }

  if (button.classList.contains('playing')) {
    button.classList.remove('playing');
    button.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
    return;
  }

  const cleanText = text
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s/gm, '')
    .trim();

  if (!('speechSynthesis' in window)) { alert('Text-to-speech is not supported in your browser.'); return; }

  const utterance  = new SpeechSynthesisUtterance(cleanText);
  utterance.rate   = 1.0;
  utterance.pitch  = 1.0;
  utterance.volume = 1.0;

  button.classList.add('playing');
  button.innerHTML = '<i class="fas fa-stop"></i> Stop';

  utterance.onend = utterance.onerror = () => {
    button.classList.remove('playing');
    button.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
    currentAudio = null;
  };

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  currentAudio = { pause: () => window.speechSynthesis.cancel() };
};

/* ── Sidebar toggle ──────────────────────────────────────── */
window.toggleSidebar = function () {
  const sidebar   = document.querySelector('.sidebar');
  const toggleBtn = document.querySelector('.sidebar-toggle-btn');
  sidebar.classList.toggle('collapsed');
  toggleBtn.querySelector('i').className =
    sidebar.classList.contains('collapsed') ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
};

window.addEventListener('resize', () => {
  if (window.innerWidth <= 768 && !document.querySelector('.mobile-header')) initMobileUI();
});

console.log('✅ Main.js loaded successfully');