// Code Artifacts Module for Snyaptium Chat
// Creates inline artifacts within the chat

let artifactCounter = 0;

// Create inline artifact
window.createInlineArtifact = function(code, messageElement) {
  artifactCounter++;
  const artifactId = `artifact-${artifactCounter}`;
  
  const artifactDiv = document.createElement('div');
  artifactDiv.className = 'inline-artifact';
  artifactDiv.id = artifactId;
  
  artifactDiv.innerHTML = `
    <div class="inline-artifact-header">
      <div class="inline-artifact-title">
        <i class="fas fa-code"></i>
        <span>Interactive Code</span>
      </div>
      <div class="inline-artifact-actions">
        <button class="inline-artifact-btn" onclick="toggleArtifactEdit('${artifactId}')" title="Edit Code">
          <i class="fas fa-edit"></i>
        </button>
        <button class="inline-artifact-btn" onclick="copyArtifactCode('${artifactId}')" title="Copy Code">
          <i class="fas fa-copy"></i>
        </button>
        <button class="inline-artifact-btn" onclick="expandArtifact('${artifactId}')" title="Expand">
          <i class="fas fa-expand"></i>
        </button>
      </div>
    </div>
    <div class="inline-artifact-preview">
      <iframe></iframe>
    </div>
    <div class="inline-artifact-editor" style="display: none;">
      <textarea class="inline-artifact-code" spellcheck="false">${escapeHtml(code)}</textarea>
      <div class="inline-artifact-editor-actions">
        <button class="inline-artifact-editor-btn secondary" onclick="cancelArtifactEdit('${artifactId}')">
          Cancel
        </button>
        <button class="inline-artifact-editor-btn primary" onclick="saveArtifactEdit('${artifactId}')">
          <i class="fas fa-play"></i> Run Code
        </button>
      </div>
    </div>
  `;
  
  messageElement.appendChild(artifactDiv);
  
  // Render initial code
  renderInlineArtifact(artifactId, code);
  
  return artifactId;
};

// Render code in iframe
function renderInlineArtifact(artifactId, code) {
  const artifact = document.getElementById(artifactId);
  if (!artifact) return;
  
  const iframe = artifact.querySelector('.inline-artifact-preview iframe');
  if (!iframe) return;
  
  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(code);
  iframeDoc.close();
}

// Toggle edit mode
window.toggleArtifactEdit = function(artifactId) {
  const artifact = document.getElementById(artifactId);
  if (!artifact) return;
  
  const preview = artifact.querySelector('.inline-artifact-preview');
  const editor = artifact.querySelector('.inline-artifact-editor');
  
  if (editor.style.display === 'none') {
    const iframe = preview.querySelector('iframe');
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const currentCode = iframeDoc.documentElement.outerHTML;
    
    artifact.querySelector('.inline-artifact-code').value = currentCode;
    
    preview.style.display = 'none';
    editor.style.display = 'flex';
  } else {
    preview.style.display = 'block';
    editor.style.display = 'none';
  }
};

// Cancel edit
window.cancelArtifactEdit = function(artifactId) {
  const artifact = document.getElementById(artifactId);
  if (!artifact) return;
  
  const preview = artifact.querySelector('.inline-artifact-preview');
  const editor = artifact.querySelector('.inline-artifact-editor');
  
  preview.style.display = 'block';
  editor.style.display = 'none';
};

// Save and run edited code
window.saveArtifactEdit = function(artifactId) {
  const artifact = document.getElementById(artifactId);
  if (!artifact) return;
  
  const preview = artifact.querySelector('.inline-artifact-preview');
  const editor = artifact.querySelector('.inline-artifact-editor');
  const code = artifact.querySelector('.inline-artifact-code').value;
  
  renderInlineArtifact(artifactId, code);
  
  preview.style.display = 'block';
  editor.style.display = 'none';
};

// Copy code
window.copyArtifactCode = function(artifactId) {
  const artifact = document.getElementById(artifactId);
  if (!artifact) return;
  
  const iframe = artifact.querySelector('.inline-artifact-preview iframe');
  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  const code = iframeDoc.documentElement.outerHTML;
  
  navigator.clipboard.writeText(code).then(() => {
    const btn = artifact.querySelector('[title="Copy Code"]');
    if (!btn) return;
    
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i>';
    setTimeout(() => {
      btn.innerHTML = originalHTML;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
};

// Expand to full screen
window.expandArtifact = function(artifactId) {
  const artifact = document.getElementById(artifactId);
  if (!artifact) return;
  
  const iframe = artifact.querySelector('.inline-artifact-preview iframe');
  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  const code = iframeDoc.documentElement.outerHTML;
  
  openFullScreenArtifact(code);
};

// Full screen artifact (keep the modal for expansion)
function openFullScreenArtifact(code) {
  const overlay = document.getElementById('artifactOverlay');
  const preview = document.getElementById('artifactPreview');
  
  if (!overlay || !preview) return;
  
  overlay.style.display = 'flex';
  overlay.classList.add('active');
  
  const iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.background = '#ffffff';
  
  preview.innerHTML = '';
  preview.appendChild(iframe);
  
  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(code);
  iframeDoc.close();
}

// Escape HTML for textarea
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Detect and create artifacts from AI responses
window.detectAndCreateArtifacts = function(messageElement) {
  const codeBlocks = messageElement.querySelectorAll('pre code');
  
  codeBlocks.forEach((codeBlock) => {
    const code = codeBlock.textContent;
    
    // Check if it's HTML code that should be an artifact
    if (code.length > 100 && 
        (code.includes('<!DOCTYPE') || 
         code.includes('<html') || 
         (code.includes('<body') || code.includes('<head')))) {
      
      // Remove the code block completely from DOM
      const pre = codeBlock.parentElement;
      pre.remove();
      
      // Create inline artifact
      createInlineArtifact(code, messageElement);
    }
  });
};

// Event listeners for full-screen modal
document.addEventListener('DOMContentLoaded', function() {
  const closeBtn = document.getElementById('artifactCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      const overlay = document.getElementById('artifactOverlay');
      if (overlay) {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
      }
    });
  }
  
  // Close on escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('artifactOverlay');
      if (overlay && overlay.classList.contains('active')) {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
      }
    }
  });
});

console.log('✨ Inline Code Artifacts Module loaded successfully');