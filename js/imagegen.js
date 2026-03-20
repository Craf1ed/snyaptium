const IMAGE_GEN_CONFIG = {
  ENDPOINT: 'https://snyaptium-img.craftedgamz.workers.dev/',
  AUTH_TOKEN: 'Bearer testpw6767',
  COOLDOWN_SECONDS: 5,
  SAFETY_KEYWORDS: ['nsfw', 'porn', 'sex', 'kidnapping', 'suicide', 'bomb', 'attack', 'kill', 'terror']
};

let imageGenCooldown = 0;
let cooldownInterval = null;
let isImageModeActive = false;

async function extractImagePrompt(userMessage, API_KEY, API_URL) {
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
          role: 'system',
          content: 'You are a prompt optimizer for image generation. Extract or create a clear, descriptive image generation prompt from the user\'s message. Keep it concise (under 150 characters) but detailed. Focus on visual elements, style, colors, and mood. Return ONLY the optimized prompt, nothing else.'
        }, {
          role: 'user',
          content: userMessage
        }],
        temperature: 0.7,
        max_tokens: 100
      })
    });

    if (!response.ok) throw new Error('Prompt extraction failed');

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Prompt extraction error:', error);
    return userMessage.replace(/^(generate|create|make|draw|show me|picture of|image of|photo of)\s+/i, '').trim();
  }
}

function checkSafety(prompt) {
  const lowerPrompt = prompt.toLowerCase();
  for (const keyword of IMAGE_GEN_CONFIG.SAFETY_KEYWORDS) {
    if (lowerPrompt.includes(keyword)) return false;
  }
  return true;
}

// Convert a blob URL to base64 data URL
async function blobUrlToBase64(blobUrl) {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function generateImage(prompt) {
  if (imageGenCooldown > 0) {
    throw new Error(`Please wait ${imageGenCooldown} seconds before generating another image.`);
  }

  if (!checkSafety(prompt)) {
    throw new Error('This prompt violates our safety guidelines. Please try a different description.');
  }

  const response = await fetch(IMAGE_GEN_CONFIG.ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': IMAGE_GEN_CONFIG.AUTH_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt })
  });

  const contentType = response.headers.get('Content-Type') || '';

  if (!response.ok) {
    if (contentType.includes('application/json')) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Image generation failed');
    }
    throw new Error(`Image generation failed with status ${response.status}`);
  }

  if (contentType.includes('application/json')) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Unexpected JSON response');
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  // Convert immediately to base64 so it persists
  const base64 = await blobUrlToBase64(blobUrl);
  URL.revokeObjectURL(blobUrl); // Clean up blob URL — we have base64 now

  return base64; // Returns a data: URL (persistent)
}

function startCooldown() {
  imageGenCooldown = IMAGE_GEN_CONFIG.COOLDOWN_SECONDS;
  if (cooldownInterval) clearInterval(cooldownInterval);
  cooldownInterval = setInterval(() => {
    imageGenCooldown--;
    if (imageGenCooldown <= 0) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
    }
  }, 1000);
}

function createImageGenStatus(statusText, isGenerating = true) {
  const statusDiv = document.createElement('div');
  statusDiv.className = `image-gen-status ${isGenerating ? 'generating' : ''}`;
  statusDiv.innerHTML = `
    <i class="fas fa-${isGenerating ? 'magic' : 'check-circle'}"></i>
    <span>${statusText}</span>
  `;
  return statusDiv;
}

function createImageGenProgress() {
  const progressDiv = document.createElement('div');
  progressDiv.className = 'image-gen-progress';
  progressDiv.innerHTML = '<div class="image-gen-progress-bar" style="width: 0%"></div>';
  return progressDiv;
}

function createImageGenError(errorMessage) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'image-gen-error';
  errorDiv.innerHTML = `
    <i class="fas fa-exclamation-circle"></i>
    <span>${errorMessage}</span>
  `;
  return errorDiv;
}

function createGeneratedImageElement(imageData, prompt) {
  const wrapper = document.createElement('div');
  wrapper.className = 'image-generation-wrapper';

  const badge = document.createElement('div');
  badge.className = 'message-badge';
  badge.innerHTML = '<i class="fas fa-image"></i> Generated Image';
  wrapper.appendChild(badge);

  const container = document.createElement('div');
  container.className = 'generated-image-container';

  const img = document.createElement('img');
  img.className = 'generated-image';
  img.src = imageData; // Works with both base64 and blob URLs
  img.alt = 'Generated image';

  const qualityBadge = document.createElement('div');
  qualityBadge.className = 'quality-badge';
  qualityBadge.innerHTML = '<i class="fas fa-sparkles"></i> AI Generated';

  container.appendChild(img);
  container.appendChild(qualityBadge);
  wrapper.appendChild(container);

  const promptDisplay = document.createElement('div');
  promptDisplay.className = 'image-prompt-display';
  promptDisplay.innerHTML = `<strong>Prompt:</strong> ${prompt}`;
  wrapper.appendChild(promptDisplay);

  const actions = document.createElement('div');
  actions.className = 'image-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'image-action-btn primary';
  downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';
  downloadBtn.onclick = () => downloadImage(imageData, 'snyaptium-generated.jpg');

  const openBtn = document.createElement('button');
  openBtn.className = 'image-action-btn';
  openBtn.innerHTML = '<i class="fas fa-external-link-alt"></i> Open in New Tab';
  openBtn.onclick = () => {
    const win = window.open();
    win.document.write(`<img src="${imageData}" style="max-width:100%">`);
  };

  const regenerateBtn = document.createElement('button');
  regenerateBtn.className = 'image-action-btn';
  regenerateBtn.innerHTML = '<i class="fas fa-redo"></i> Regenerate';
  regenerateBtn.onclick = () => {
    window.toggleImageMode(true);
    document.getElementById('userInput').value = prompt;
    window.sendMessage();
  };

  actions.appendChild(downloadBtn);
  actions.appendChild(openBtn);
  actions.appendChild(regenerateBtn);
  wrapper.appendChild(actions);

  return wrapper;
}

function downloadImage(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

window.toggleImageMode = function(forceState = null) {
  const imageBtn = document.getElementById('imageGenBtn');

  if (forceState !== null) {
    isImageModeActive = forceState;
  } else {
    isImageModeActive = !isImageModeActive;
  }

  if (isImageModeActive) {
    imageBtn.classList.add('active');
    imageBtn.innerHTML = '<i class="fas fa-image"></i>';
    document.getElementById('userInput').placeholder = 'Describe the image you want to generate...';
  } else {
    imageBtn.classList.remove('active');
    imageBtn.innerHTML = '<i class="far fa-image"></i>';
    document.getElementById('userInput').placeholder = 'Lets talk about...';
  }
};

window.sendMessageWithImageGen = async function(API_KEY, API_URL, currentUser, messages, currentModel, SYSTEM_PROMPT, saveCurrentChatFn, addMessageToUIFn, hideTypingIndicatorFn, showTypingIndicatorFn) {
  const input = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const userMessage = input.value.trim();

  if (!userMessage) return;

  addMessageToUIFn(userMessage, 'user');
  messages.push({ role: 'user', content: userMessage });

  input.value = '';
  input.style.height = 'auto';
  input.disabled = true;
  sendBtn.disabled = true;

  showTypingIndicatorFn();

  try {
    if (isImageModeActive) {
      window.toggleImageMode(false);
      hideTypingIndicatorFn();

      const chatContainer = document.getElementById('chatContainer');
      const wrapper = document.createElement('div');
      wrapper.className = 'message-wrapper ai';

      const avatar = document.createElement('div');
      avatar.className = 'avatar ai';
      const img = document.createElement('img');
      img.src = 'img/logo.png';
      img.alt = 'AI';
      avatar.appendChild(img);

      const messageContent = document.createElement('div');
      messageContent.className = 'message-content';

      const status = createImageGenStatus('Analyzing your request...', true);
      messageContent.appendChild(status);

      const progress = createImageGenProgress();
      messageContent.appendChild(progress);

      wrapper.appendChild(avatar);
      wrapper.appendChild(messageContent);
      chatContainer.appendChild(wrapper);
      chatContainer.scrollTop = chatContainer.scrollHeight;

      status.innerHTML = '<i class="fas fa-magic"></i> <span>Optimizing image prompt...</span>';
      const progressBar = progress.querySelector('.image-gen-progress-bar');
      progressBar.style.width = '30%';

      const optimizedPrompt = await extractImagePrompt(userMessage, API_KEY, API_URL);

      status.innerHTML = '<i class="fas fa-magic"></i> <span>Generating your image...</span>';
      progressBar.style.width = '60%';

      // generateImage now returns a base64 data URL directly
      const imageBase64 = await generateImage(optimizedPrompt);

      progressBar.style.width = '100%';

      setTimeout(() => {
        messageContent.innerHTML = '';
        const imageElement = createGeneratedImageElement(imageBase64, optimizedPrompt);
        messageContent.appendChild(imageElement);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        startCooldown();

        if (imageGenCooldown > 0) {
          const cooldownDiv = document.createElement('div');
          cooldownDiv.className = 'image-cooldown';
          cooldownDiv.innerHTML = `<i class="fas fa-clock"></i> <span>Next generation available in ${imageGenCooldown}s</span>`;
          messageContent.appendChild(cooldownDiv);

          const cooldownIntervalId = setInterval(() => {
            if (imageGenCooldown <= 0) {
              clearInterval(cooldownIntervalId);
              cooldownDiv.remove();
            } else {
              cooldownDiv.querySelector('span').textContent = `Next generation available in ${imageGenCooldown}s`;
            }
          }, 1000);
        }
      }, 500);

      // Save base64 directly — persistent across sessions
      messages.push({
        role: 'assistant',
        content: `[Generated Image: ${optimizedPrompt}]`,
        type: 'image',
        imageBase64: imageBase64, // base64 data URL, not a blob
        prompt: optimizedPrompt
      });

      await saveCurrentChatFn();

    } else {
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

      hideTypingIndicatorFn();
      addMessageToUIFn(aiMessage, 'ai');
      messages.push({ role: 'assistant', content: aiMessage });

      await saveCurrentChatFn();
    }

  } catch (error) {
    hideTypingIndicatorFn();

    const chatContainer = document.getElementById('chatContainer');
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper ai';

    const avatar = document.createElement('div');
    avatar.className = 'avatar ai';
    const img = document.createElement('img');
    img.src = 'img/logo.png';
    img.alt = 'AI';
    avatar.appendChild(img);

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    const errorElement = createImageGenError(error.message || 'Sorry, I encountered an error. Please try again.');
    messageContent.appendChild(errorElement);

    wrapper.appendChild(avatar);
    wrapper.appendChild(messageContent);
    chatContainer.appendChild(wrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    console.error('Error:', error);
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
};

window.loadChatWithImages = function(chat, addMessageToUIFn) {
  const chatContainer = document.getElementById('chatContainer');
  chatContainer.innerHTML = '';

  if (!chat.messages) return;

  chat.messages.forEach(msg => {
    if (msg.role === 'user') {
      // Handle vision messages (user uploaded image)
      if (Array.isArray(msg.content)) {
        const text = msg.content.find(c => c.type === 'text')?.text || '';
        const imageUrl = msg.content.find(c => c.type === 'image_url')?.image_url?.url || null;

        const cc = chatContainer;
        const w  = document.createElement('div'); w.className = 'message-wrapper user';
        const av = document.createElement('div'); av.className = 'avatar user';
        av.textContent = '?'; // Will be overridden by main.js avatar logic if needed

        const mc = document.createElement('div'); mc.className = 'message-content';
        if (imageUrl) {
          const imgEl = document.createElement('img');
          imgEl.src = imageUrl; // base64 data URL — persists fine
          imgEl.className = 'user-attached-image';
          imgEl.alt = 'Attached image';
          mc.appendChild(imgEl);
        }
        if (text) {
          const p = document.createElement('p'); p.textContent = text; mc.appendChild(p);
        }
        w.appendChild(av); w.appendChild(mc); cc.appendChild(w);
      } else {
        addMessageToUIFn(msg.content, 'user');
      }
    } else if (msg.role === 'assistant') {
      // Use imageBase64 (new) with fallback to imageUrl (legacy)
      const imageData = msg.imageBase64 || msg.imageUrl;
      if (msg.type === 'image' && imageData && msg.prompt) {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper ai';

        const avatar = document.createElement('div');
        avatar.className = 'avatar ai';
        const img = document.createElement('img');
        img.src = 'img/logo.png';
        img.alt = 'AI';
        avatar.appendChild(img);

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        const imageElement = createGeneratedImageElement(imageData, msg.prompt);
        messageContent.appendChild(imageElement);

        wrapper.appendChild(avatar);
        wrapper.appendChild(messageContent);
        chatContainer.appendChild(wrapper);
      } else {
        addMessageToUIFn(msg.content, 'ai');
      }
    }
  });

  chatContainer.scrollTop = chatContainer.scrollHeight;
};

window.ImageGenModule = {
  extractImagePrompt,
  generateImage,
  checkSafety,
  startCooldown,
  createGeneratedImageElement,
  createImageGenStatus,
  createImageGenProgress,
  createImageGenError,
  downloadImage,
  CONFIG: IMAGE_GEN_CONFIG,
  getCooldown: () => imageGenCooldown
};

console.log('✨ Image Generation Module loaded successfully');