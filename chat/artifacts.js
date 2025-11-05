// Code Artifacts Module for Snyaptium Chat
// Enables interactive code editing and preview like Claude Artifacts

let currentArtifactCode = '';
let currentArtifactTitle = 'Code Artifact';

// Open artifact window
window.openArtifact = function(code, title = 'Code Artifact') {
  currentArtifactCode = code;
  currentArtifactTitle = title;
  
  const overlay = document.getElementById('artifactOverlay');
  const titleEl = document.getElementById('artifactTitle');
  const preview = document.getElementById('artifactPreview');
  
  titleEl.textContent = title;
  overlay.classList.add('active');
  
  renderArtifact(code);
};

// Render code in preview
function renderArtifact(code) {
  const preview = document.getElementById('artifactPreview');
  
  // Create iframe for isolated execution
  const iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.background = '#ffffff';
  
  preview.innerHTML = '';
  preview.appendChild(iframe);
  
  // Write code to iframe
  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(code);
  iframeDoc.close();
}

// Event listeners
document.getElementById('artifactCloseBtn').addEventListener('click', function() {
  document.getElementById('artifactOverlay').classList.remove('active');
});

document.getElementById('artifactEditBtn').addEventListener('click', function() {
  const preview = document.getElementById('artifactPreview');
  const editor = document.getElementById('artifactEditor');
  const codeInput = document.getElementById('artifactCodeInput');
  
  codeInput.value = currentArtifactCode;
  preview.style.display = 'none';
  editor.style.display = 'flex';
});

document.getElementById('artifactCancelEdit').addEventListener('click', function() {
  const preview = document.getElementById('artifactPreview');
  const editor = document.getElementById('artifactEditor');
  
  preview.style.display = 'block';
  editor.style.display = 'none';
});

document.getElementById('artifactSaveEdit').addEventListener('click', function() {
  const codeInput = document.getElementById('artifactCodeInput');
  const preview = document.getElementById('artifactPreview');
  const editor = document.getElementById('artifactEditor');
  
  currentArtifactCode = codeInput.value;
  
  renderArtifact(currentArtifactCode);
  
  preview.style.display = 'block';
  editor.style.display = 'none';
});

document.getElementById('artifactCopyBtn').addEventListener('click', function() {
  navigator.clipboard.writeText(currentArtifactCode).then(() => {
    const btn = document.getElementById('artifactCopyBtn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i>';
    setTimeout(() => {
      btn.innerHTML = originalHTML;
    }, 2000);
  });
});

// Close on escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('artifactOverlay');
    if (overlay.classList.contains('active')) {
      overlay.classList.remove('active');
    }
  }
});

// Detect code blocks in messages and add "Open in Artifact" button
window.enhanceCodeBlocks = function() {
  const codeBlocks = document.querySelectorAll('.message-content pre code');
  
  codeBlocks.forEach((codeBlock, index) => {
    const pre = codeBlock.parentElement;
    
    // Skip if button already exists
    if (pre.nextElementSibling && pre.nextElementSibling.classList.contains('code-artifact-btn')) {
      return;
    }
    
    const code = codeBlock.textContent;
    
    // Only add button for HTML/substantial code
    if (code.length > 50 && (code.includes('<html') || code.includes('<!DOCTYPE') || code.includes('<body') || code.includes('<div'))) {
      const btn = document.createElement('button');
      btn.className = 'code-artifact-btn';
      btn.innerHTML = '<i class="fas fa-external-link-alt"></i> Open in Artifact';
      btn.onclick = () => openArtifact(code, `Code Artifact ${index + 1}`);
      
      pre.parentElement.insertBefore(btn, pre.nextSibling);
    }
  });
};

console.log('✨ Code Artifacts Module loaded successfully');