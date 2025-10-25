import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, updateProfile, updatePassword } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, doc, getDocs, query, where, deleteDoc, serverTimestamp, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";

let firebaseConfig;
let API_KEY;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function loadEnv() {
  try {
    const [firebaseRes, aiRes] = await Promise.all([
      fetch('/.netlify/functions/get-firebase'),
      fetch('/.netlify/functions/get-ai-api')
    ]);
    const firebaseData = await firebaseRes.json();
    const aiData = await aiRes.json();
    firebaseConfig = firebaseData.firebaseConfig;
    API_KEY = aiData.apiKey;
    console.log('✅ Environment loaded successfully');
  } catch (error) {
    console.error('❌ Error loading environment:', error);
    throw error;
  }
}

await loadEnv();

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser = null;
let currentModel = 'llama-3.3-70b-versatile';
let messages = [];
let currentChatId = null;
let chatHistory = [];
let aiRecommendations = [];
let isGeneratingRecommendations = false;
let userProfilePic = null;
let recognition = null;
let isListening = false;
let currentAudio = null;

const SYSTEM_PROMPT = {
  role: 'system',
  content: 'You are Snyaptium AI, an intelligent and helpful AI assistant created by Snyaptium. You are designed to assist users with a wide variety of tasks including answering questions, writing, coding, analysis, creative tasks, and more. You are knowledgeable, friendly, and professional. Always strive to provide accurate, helpful, and comprehensive responses.'
};

function initSpeechRecognition() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = function(event) {
      const transcript = event.results[0][0].transcript;
      document.getElementById('userInput').value = transcript;
      autoResize(document.getElementById('userInput'));
    };

    recognition.onerror = function(event) {
      console.error('Speech recognition error:', event.error);
      stopVoiceInput();
    };

    recognition.onend = function() {
      stopVoiceInput();
    };
  }
}

// Initialize mobile UI components
function initMobileUI() {
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    console.log('📱 Initializing mobile UI...');
    
    // Check if mobile header already exists
    if (!document.querySelector('.mobile-header')) {
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
        console.log('✅ Mobile header created');
      }
      
      // Add mobile overlay for sidebar
      if (!document.querySelector('.mobile-sidebar-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'mobile-sidebar-overlay';
        overlay.onclick = () => toggleMobileSidebar();
        document.body.appendChild(overlay);
        console.log('✅ Mobile overlay created');
      }
    }
  }
}

// Toggle mobile sidebar
window.toggleMobileSidebar = function() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.mobile-sidebar-overlay');
  
  if (sidebar && overlay) {
    sidebar.classList.toggle('mobile-open');
    overlay.classList.toggle('active');
  }
};

onAuthStateChanged(auth, async (user) => {
  console.log('🔐 Auth state changed:', user ? 'Logged in' : 'Logged out');
  
  if (user) {
    currentUser = user;
    
    try {
      // Hide loading screen
      const loadingScreen = document.getElementById('loadingScreen');
      const mainApp = document.getElementById('mainApp');
      
      console.log('👤 Loading user profile...');
      await loadUserProfile();
      
      console.log('🎤 Initializing speech recognition...');
      initSpeechRecognition();
      
      console.log('💬 Loading chat history...');
      await loadChatHistory();
      
      console.log('🎨 Initializing UI...');
      initCustomDropdown();
      initMobileUI();
      
      // Show main app
      if (loadingScreen) {
        loadingScreen.style.display = 'none';
      }
      
      if (mainApp) {
        mainApp.style.display = 'flex';
        console.log('✅ Main app displayed');
      }
      
      // Generate recommendations after a short delay
      setTimeout(() => {
        console.log('💡 Generating recommendations...');
        generateRecommendations();
      }, 1000);
      
      console.log('✅ App initialization complete');
      
    } catch (error) {
      console.error('❌ Error during initialization:', error);
      alert('Error loading app. Please refresh the page.');
    }
    
  } else {
    console.log('➡️ Redirecting to signup...');
    window.location.href = 'signup.html';
  }
});

async function loadUserProfile() {
  try {
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    const userData = userDoc.exists() ? userDoc.data() : {};
    
    const displayName = userData.displayName || currentUser.displayName || currentUser.email;
    userProfilePic = userData.profilePicURL || null;
    
    document.getElementById('userName').textContent = displayName;
    document.getElementById('welcomeTitle').textContent = `Welcome to Snyaptium, ${displayName.split(' ')[0]}`;
    
    console.log('✅ User profile loaded:', displayName);
  } catch (error) {
    console.error('Error loading user profile:', error);
    document.getElementById('userName').textContent = currentUser.displayName || currentUser.email;
  }
}

window.openSettings = async function() {
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsName = document.getElementById('settingsName');
  const settingsPassword = document.getElementById('settingsPassword');
  const settingsPasswordConfirm = document.getElementById('settingsPasswordConfirm');
  const profilePicPreview = document.getElementById('profilePicPreview');
  const profilePicInitial = document.getElementById('profilePicInitial');
  
  try {
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    const userData = userDoc.exists() ? userDoc.data() : {};
    
    settingsName.value = userData.displayName || currentUser.displayName || '';
    settingsPassword.value = '';
    settingsPasswordConfirm.value = '';
    
    if (userData.profilePicURL) {
      profilePicPreview.innerHTML = `<img src="${userData.profilePicURL}" alt="Profile">`;
    } else {
      const initial = (userData.displayName || currentUser.displayName || currentUser.email || 'U')[0].toUpperCase();
      profilePicInitial.textContent = initial;
      profilePicPreview.innerHTML = `<span id="profilePicInitial">${initial}</span>`;
    }
    
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  
  settingsOverlay.classList.add('active');
}

document.getElementById('profilePicInput').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(event) {
      document.getElementById('profilePicPreview').innerHTML = `<img src="${event.target.result}" alt="Profile">`;
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById('removePicBtn').addEventListener('click', function() {
  const profilePicPreview = document.getElementById('profilePicPreview');
  const settingsName = document.getElementById('settingsName');
  const initial = (settingsName.value || currentUser.displayName || currentUser.email || 'U')[0].toUpperCase();
  
  profilePicPreview.innerHTML = `<span id="profilePicInitial">${initial}</span>`;
  document.getElementById('profilePicInput').value = '';
});

document.getElementById('settingsSave').addEventListener('click', async function() {
  const settingsName = document.getElementById('settingsName').value.trim();
  const settingsPassword = document.getElementById('settingsPassword').value;
  const settingsPasswordConfirm = document.getElementById('settingsPasswordConfirm').value;
  const profilePicInput = document.getElementById('profilePicInput');
  
  try {
    if (settingsPassword && settingsPassword !== settingsPasswordConfirm) {
      alert('Passwords do not match!');
      return;
    }
    
    let profilePicURL = userProfilePic;
    
    if (profilePicInput.files[0]) {
      const file = profilePicInput.files[0];
      const reader = new FileReader();
      
      profilePicURL = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } else if (!document.getElementById('profilePicPreview').querySelector('img')) {
      if (userProfilePic) {
        try {
          const storageRef = ref(storage, `profilePics/${currentUser.uid}`);
          await deleteObject(storageRef);
        } catch (error) {
          console.log('No profile pic to delete or error:', error);
        }
      }
      profilePicURL = null;
    }
    
    if (settingsName) {
      await updateProfile(currentUser, {
        displayName: settingsName
      });
    }
    
    if (settingsPassword) {
      await updatePassword(currentUser, settingsPassword);
    }
    
    await setDoc(doc(db, 'users', currentUser.uid), {
      displayName: settingsName || currentUser.displayName,
      profilePicURL: profilePicURL,
      updatedAt: serverTimestamp()
    }, { merge: true });
    
    userProfilePic = profilePicURL;
    
    await loadUserProfile();
    
    document.getElementById('settingsOverlay').classList.remove('active');
    
    alert('Settings saved successfully!');
    
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Error saving settings: ' + error.message);
  }
});

document.getElementById('settingsCancel').addEventListener('click', function() {
  document.getElementById('settingsOverlay').classList.remove('active');
});

document.getElementById('settingsOverlay').addEventListener('click', function(e) {
  if (e.target === this) {
    this.classList.remove('active');
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.getElementById('settingsOverlay').classList.remove('active');
  }
});

window.handleLogout = async function() {
  try {
    await signOut(auth);
    window.location.href = 'signup.html';
  } catch (error) {
    console.error('Logout error:', error);
  }
}

async function loadChatHistory() {
  try {
    const q = query(
      collection(db, 'chats'),
      where('userId', '==', currentUser.uid)
    );
    const querySnapshot = await getDocs(q);
    chatHistory = [];
    querySnapshot.forEach((doc) => {
      chatHistory.push({ id: doc.id, ...doc.data() });
    });
    chatHistory.sort((a, b) => {
      const aTime = a.updatedAt?.toMillis() || 0;
      const bTime = b.updatedAt?.toMillis() || 0;
      return bTime - aTime;
    });
    updateHistoryList();
    console.log(`✅ Loaded ${chatHistory.length} chats`);
  } catch (error) {
    console.error('Error loading chat history:', error);
  }
}

function updateHistoryList() {
  const historyList = document.getElementById('historyList');
  historyList.innerHTML = chatHistory.map(chat => `
    <div class="history-item ${currentChatId === chat.id ? 'active' : ''}" onclick="loadChat('${chat.id}'); window.innerWidth <= 768 && toggleMobileSidebar();">
      <div class="history-item-title">${chat.title || 'New Chat'}</div>
      <button class="delete-chat-btn" onclick="event.stopPropagation(); deleteChat('${chat.id}')">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `).join('');
}

window.deleteChat = async function(chatId) {
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmDelete = document.getElementById('confirmDelete');
  const confirmCancel = document.getElementById('confirmCancel');
  
  confirmOverlay.classList.add('active');
  
  const userDecision = await new Promise((resolve) => {
    const deleteHandler = () => {
      cleanup();
      resolve(true);
    };
    
    const cancelHandler = () => {
      cleanup();
      resolve(false);
    };
    
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(false);
      }
    };
    
    const overlayHandler = (e) => {
      if (e.target === confirmOverlay) {
        cleanup();
        resolve(false);
      }
    };
    
    const cleanup = () => {
      confirmDelete.removeEventListener('click', deleteHandler);
      confirmCancel.removeEventListener('click', cancelHandler);
      document.removeEventListener('keydown', escapeHandler);
      confirmOverlay.removeEventListener('click', overlayHandler);
      confirmOverlay.classList.remove('active');
    };
    
    confirmDelete.addEventListener('click', deleteHandler);
    confirmCancel.addEventListener('click', cancelHandler);
    document.addEventListener('keydown', escapeHandler);
    confirmOverlay.addEventListener('click', overlayHandler);
  });
  
  if (userDecision) {
    try {
      await deleteDoc(doc(db, 'chats', chatId));
      if (currentChatId === chatId) {
        newChat();
      }
      await loadChatHistory();
    } catch (error) {
      console.error('Error deleting chat:', error);
    }
  }
}

window.loadChat = async function(chatId) {
  const chat = chatHistory.find(c => c.id === chatId);
  if (chat) {
    currentChatId = chatId;
    messages = chat.messages || [];
    currentModel = chat.model || 'llama-3.3-70b-versatile';
    
    const modelNames = {
      'llama-3.3-70b-versatile': 'LLaMA 3.3 70B Versatile',
      'llama-3.1-8b-instant': 'LLaMA 3.1 8B Instant',
      'compound-beta': 'Groq Compound Beta',
      'openai/gpt-oss-120b': 'GPT OSS 120B',
      'openai/gpt-oss-20b': 'GPT OSS 20B'
    };
    document.getElementById('selectedModel').textContent = modelNames[currentModel] || 'LLaMA 3.3 70B Versatile';
    
    const modelOptions = document.querySelectorAll('.model-option');
    modelOptions.forEach(opt => {
      if (opt.getAttribute('data-value') === currentModel) {
        opt.classList.add('selected');
      } else {
        opt.classList.remove('selected');
      }
    });
    
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.innerHTML = '';
    messages.forEach(msg => {
      if (msg.role === 'user') {
        addMessageToUI(msg.content, 'user');
      } else if (msg.role === 'assistant') {
        addMessageToUI(msg.content, 'ai');
      }
    });
    updateHistoryList();
  }
}

async function saveCurrentChat() {
  if (!currentUser || messages.length === 0) return;
  
  try {
    let chatTitle = messages[0]?.content?.substring(0, 50) || 'New Chat';
    
    if (!currentChatId && messages.length >= 2) {
      chatTitle = await generateChatTitle();
    }
    
    const chatData = {
      userId: currentUser.uid,
      title: chatTitle,
      messages: messages,
      model: currentModel,
      updatedAt: serverTimestamp()
    };
    
    if (currentChatId) {
      await updateDoc(doc(db, 'chats', currentChatId), chatData);
    } else {
      const docRef = await addDoc(collection(db, 'chats'), {
        ...chatData,
        createdAt: serverTimestamp()
      });
      currentChatId = docRef.id;
    }
    await loadChatHistory();
  } catch (error) {
    console.error('Error saving chat:', error);
  }
}

window.newChat = async function() {
  currentChatId = null;
  messages = [];
  const chatContainer = document.getElementById('chatContainer');
  
  const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
  const userData = userDoc.exists() ? userDoc.data() : {};
  const displayName = userData.displayName || currentUser.displayName || currentUser.email;
  const firstName = displayName.split(' ')[0];
  
  if (aiRecommendations.length === 0) {
    chatContainer.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-title">Welcome to Snyaptium, ${firstName}</div>
        <div class="welcome-subtitle">Your intelligent AI companion ready to assist with any task.</div>
        <div class="suggestion-cards">
          <div class="suggestion-card generating">
            <div class="suggestion-card-title">Generating...</div>
            <div class="suggestion-card-text">AI is creating suggestions</div>
          </div>
          <div class="suggestion-card generating">
            <div class="suggestion-card-title">Generating...</div>
            <div class="suggestion-card-text">AI is creating suggestions</div>
          </div>
          <div class="suggestion-card generating">
            <div class="suggestion-card-title">Generating...</div>
            <div class="suggestion-card-text">AI is creating suggestions</div>
          </div>
          <div class="suggestion-card generating">
            <div class="suggestion-card-title">Generating...</div>
            <div class="suggestion-card-text">AI is creating suggestions</div>
          </div>
        </div>
      </div>
    `;
  } else {
    chatContainer.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-title">Welcome to Snyaptium, ${firstName}</div>
        <div class="welcome-subtitle">Your intelligent AI companion ready to assist with any task.</div>
        <div class="suggestion-cards">
          ${aiRecommendations.map((s, index) => `
            <div class="suggestion-card loaded" style="animation-delay: ${index * 0.1}s" onclick="useSuggestion('${s.prompt.replace(/'/g, "\\'")}')">
              <div class="suggestion-card-title">${s.title}</div>
              <div class="suggestion-card-text">${s.text}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  updateHistoryList();
  
  // Close mobile sidebar if open
  if (window.innerWidth <= 768) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.mobile-sidebar-overlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('active');
  }
}

function initCustomDropdown() {
  const customSelect = document.getElementById('customSelect');
  const modelOverlay = document.getElementById('modelOverlay');
  const selectedModel = document.getElementById('selectedModel');
  const modelOptions = document.querySelectorAll('.model-option');

  customSelect.addEventListener('click', function(e) {
    e.stopPropagation();
    modelOverlay.classList.add('active');
  });

  modelOverlay.addEventListener('click', function(e) {
    if (e.target === modelOverlay) {
      modelOverlay.classList.remove('active');
    }
  });

  modelOptions.forEach(option => {
    option.addEventListener('click', function(e) {
      e.stopPropagation();
      
      modelOptions.forEach(opt => opt.classList.remove('selected'));
      this.classList.add('selected');
      
      const modelName = this.querySelector('.model-option-name').textContent;
      selectedModel.textContent = modelName;
      currentModel = this.getAttribute('data-value');
      
      modelOverlay.classList.remove('active');
      
      addSystemMessage(`Model changed to ${modelName}`);
    });
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      modelOverlay.classList.remove('active');
    }
  });
}

window.useSuggestion = function(text) {
  document.getElementById('userInput').value = text;
  sendMessage();
}

window.autoResize = function(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

window.handleKeyPress = function(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function hideWelcomeScreen() {
  const welcomeScreen = document.querySelector('.welcome-screen');
  if (welcomeScreen) welcomeScreen.remove();
}

function addMessageToUI(content, type) {
  hideWelcomeScreen();
  const chatContainer = document.getElementById('chatContainer');
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${type}`;
  
  const avatar = document.createElement('div');
  avatar.className = `avatar ${type}`;
  
  if (type === 'user') {
    if (userProfilePic) {
      avatar.classList.add('has-image');
      const img = document.createElement('img');
      img.src = userProfilePic;
      img.alt = 'User';
      avatar.appendChild(img);
    } else {
      const initial = (currentUser.displayName || currentUser.email || 'U')[0].toUpperCase();
      avatar.textContent = initial;
    }
  } else {
    const img = document.createElement('img');
    img.src = 'logo.png';
    img.alt = 'AI';
    avatar.appendChild(img);
  }
  
  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';
  
  if (type === 'ai') {
    messageContent.innerHTML = marked.parse(content);
    
    const speakerBtn = document.createElement('button');
    speakerBtn.className = 'speaker-btn';
    speakerBtn.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
    speakerBtn.onclick = () => speakText(content, speakerBtn);
    messageContent.appendChild(speakerBtn);
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
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper ai';
  wrapper.style.opacity = '0.6';
  
  const avatar = document.createElement('div');
  avatar.className = 'avatar ai';
  avatar.textContent = 'ℹ';
  
  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';
  messageContent.textContent = content;
  
  wrapper.appendChild(avatar);
  wrapper.appendChild(messageContent);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function showTypingIndicator() {
  hideWelcomeScreen();
  const chatContainer = document.getElementById('chatContainer');
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper ai';
  wrapper.id = 'typingIndicator';
  
  const avatar = document.createElement('div');
  avatar.className = 'avatar ai';
  const img = document.createElement('img');
  img.src = 'logo.png';
  img.alt = 'AI';
  avatar.appendChild(img);
  
  const typingDiv = document.createElement('div');
  typingDiv.className = 'typing-indicator';
  typingDiv.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  
  wrapper.appendChild(avatar);
  wrapper.appendChild(typingDiv);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.remove();
}

window.sendMessage = async function() {
  const input = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const userMessage = input.value.trim();
  
  if (!userMessage) return;
  
  if (typeof window.sendMessageWithImageGen === 'function') {
    console.log('🚀 Using image-gen enabled sendMessage');
    await window.sendMessageWithImageGen(
      API_KEY,
      API_URL,
      currentUser,
      messages,
      currentModel,
      SYSTEM_PROMPT,
      saveCurrentChat,
      addMessageToUI,
      hideTypingIndicator,
      showTypingIndicator
    );
  } else {
    console.log('📝 Using standard sendMessage');
    addMessageToUI(userMessage, 'user');
    messages.push({ role: 'user', content: userMessage });
    
    input.value = '';
    input.style.height = 'auto';
    input.disabled = true;
    sendBtn.disabled = true;
    
    showTypingIndicator();
    
    try {
      const apiMessages = [SYSTEM_PROMPT, ...messages];
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: currentModel,
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: 1024
        })
      });
      
      if (!response.ok) throw new Error('API request failed');
      
      const data = await response.json();
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
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
};

async function generateRecommendations() {
  if (isGeneratingRecommendations) return;
  isGeneratingRecommendations = true;
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{
          role: 'user',
          content: 'Generate 4 creative and diverse conversation starter suggestions for an AI chat interface. Each suggestion should have a short title (2-4 words), a brief description (4-6 words), and a specific example prompt. Format your response as JSON array with objects containing "title", "text", and "prompt" fields. Make them varied across different topics like coding, writing, learning, productivity, creativity, etc. Only respond with the JSON array, nothing else.'
        }],
        temperature: 0.9,
        max_tokens: 500
      })
    });
    
    if (!response.ok) throw new Error('Failed to generate recommendations');
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length >= 4) {
          aiRecommendations = parsed.slice(0, 4);
          const welcomeScreen = document.querySelector('.welcome-screen');
          if (welcomeScreen && messages.length === 0) {
            const cards = document.querySelectorAll('.suggestion-card.generating');
            cards.forEach((card, index) => {
              setTimeout(() => {
                card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                card.style.opacity = '0';
                card.style.transform = 'scale(0.95)';
              }, index * 50);
            });
            
            setTimeout(() => {
              newChat();
            }, 300);
          }
        }
      }
    } catch (parseError) {
      console.error('Error parsing recommendations:', parseError);
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
    const aiMsg = messages.find(m => m.role === 'assistant')?.content || '';
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{
          role: 'user',
          content: `Generate a short, descriptive title (3-6 words max) for a chat conversation that started with:\nUser: "${userMsg.substring(0, 200)}"\nAssistant: "${aiMsg.substring(0, 200)}"\n\nOnly respond with the title, nothing else. No quotes or punctuation at the end.`
        }],
        temperature: 0.7,
        max_tokens: 30
      })
    });
    
    if (!response.ok) throw new Error('Failed to generate title');
    
    const data = await response.json();
    let title = data.choices[0].message.content.trim();
    
    title = title.replace(/^["']|["']$/g, '');
    title = title.replace(/[.!?]$/, '');
    title = title.substring(0, 50);
    
    return title || messages[0]?.content?.substring(0, 50) || 'New Chat';
  } catch (error) {
    console.error('Error generating chat title:', error);
    return messages[0]?.content?.substring(0, 50) || 'New Chat';
  }
}

window.toggleVoiceInput = function() {
  const voiceBtn = document.getElementById('voiceInputBtn');
  
  if (!recognition) {
    alert('Speech recognition is not supported in your browser.');
    return;
  }

  if (isListening) {
    recognition.stop();
    stopVoiceInput();
  } else {
    recognition.start();
    isListening = true;
    voiceBtn.classList.add('listening');
    voiceBtn.innerHTML = '<i class="fas fa-stop"></i>';
  }
};

function stopVoiceInput() {
  const voiceBtn = document.getElementById('voiceInputBtn');
  isListening = false;
  voiceBtn.classList.remove('listening');
  voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
}

window.speakText = function(text, button) {
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

  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    button.classList.add('playing');
    button.innerHTML = '<i class="fas fa-stop"></i> Stop';

    utterance.onend = function() {
      button.classList.remove('playing');
      button.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
      currentAudio = null;
    };

    utterance.onerror = function(event) {
      console.error('Speech synthesis error:', event);
      button.classList.remove('playing');
      button.innerHTML = '<i class="fas fa-volume-up"></i> Listen';
      currentAudio = null;
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    currentAudio = { pause: () => window.speechSynthesis.cancel() };
  } else {
    alert('Text-to-speech is not supported in your browser.');
  }
};

// Handle window resize for mobile/desktop switching
window.addEventListener('resize', () => {
  const isMobile = window.innerWidth <= 768;
  if (isMobile && !document.querySelector('.mobile-header')) {
    initMobileUI();
  }
});

console.log('✅ Main.js loaded successfully');