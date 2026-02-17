// Initialize markdown-it for client-side preview
const md = window.markdownit({
  html: false,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (__) {}
    }
    return '';
  }
});

// DOM elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const markdownTextarea = document.getElementById('markdown');
const slugInput = document.getElementById('slug');
const previewBtn = document.getElementById('previewBtn');
const previewText = document.getElementById('previewText');
const previewContainer = document.getElementById('previewContainer');
const previewContent = document.getElementById('previewContent');
const publishBtn = document.getElementById('publishBtn');
const uploadForm = document.getElementById('uploadForm');
const resultContainer = document.getElementById('resultContainer');
const resultUrl = document.getElementById('resultUrl');
const copyBtn = document.getElementById('copyBtn');
const visitBtn = document.getElementById('visitBtn');

let isPreviewVisible = false;

// File drop functionality with better feedback
dropZone.addEventListener('click', () => {
  fileInput.click();
});

dropZone.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  // Only remove dragover if we're actually leaving the drop zone
  const rect = dropZone.getBoundingClientRect();
  const x = e.clientX;
  const y = e.clientY;
  if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
    dropZone.classList.remove('dragover');
  }
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

// Handle file reading with visual feedback
function handleFile(file) {
  if (!file.name.match(/\.(md|markdown|txt)$/i)) {
    showError('Please select a markdown file (.md, .markdown, or .txt)');
    return;
  }
  
  if (file.size > 1024 * 1024) { // 1MB limit
    showError('File too large. Maximum size is 1MB.');
    return;
  }
  
  // Show processing state
  dropZone.classList.add('processing');
  const originalText = dropZone.querySelector('.drop-zone-text').textContent;
  dropZone.querySelector('.drop-zone-text').textContent = 'Reading file...';
  
  const reader = new FileReader();
  
  reader.onload = (e) => {
    try {
      markdownTextarea.value = e.target.result;
      
      // Auto-generate slug from first heading if slug is empty
      if (!slugInput.value.trim()) {
        const title = extractTitle(e.target.result);
        if (title !== 'Untitled') {
          slugInput.value = generateSlug(title);
        }
      }
      
      // Show success feedback
      dropZone.classList.remove('processing');
      dropZone.classList.add('success');
      dropZone.querySelector('.drop-zone-text').textContent = `✅ Loaded ${file.name}`;
      
      setTimeout(() => {
        dropZone.classList.remove('success');
        dropZone.querySelector('.drop-zone-text').textContent = originalText;
      }, 2000);
      
    } catch (error) {
      console.error('File reading error:', error);
      showError('Error reading file. Please try again.');
      resetDropZone(originalText);
    }
  };
  
  reader.onerror = () => {
    showError('Error reading file. Please try again.');
    resetDropZone(originalText);
  };
  
  reader.readAsText(file);
}

function resetDropZone(originalText) {
  dropZone.classList.remove('processing', 'success');
  dropZone.querySelector('.drop-zone-text').textContent = originalText;
}

function showError(message) {
  // Create a more elegant error display instead of alert
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #dc2626;
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 6px;
    font-family: var(--font-heading);
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
    z-index: 1000;
    animation: slideIn 0.3s ease-out;
  `;
  
  // Add keyframes for the animation
  if (!document.querySelector('#error-keyframes')) {
    const style = document.createElement('style');
    style.id = 'error-keyframes';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(errorDiv);
  
  setTimeout(() => {
    errorDiv.style.animation = 'slideIn 0.3s ease-out reverse';
    setTimeout(() => errorDiv.remove(), 300);
  }, 3000);
}

// Extract title from first H1
function extractTitle(markdown) {
  const lines = markdown.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.substring(2).trim();
    }
  }
  return 'Untitled';
}

// Generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Auto-generate slug when title changes
markdownTextarea.addEventListener('input', () => {
  if (!slugInput.value.trim()) {
    const title = extractTitle(markdownTextarea.value);
    if (title !== 'Untitled') {
      slugInput.value = generateSlug(title);
    }
  }
});

// Validate slug input
slugInput.addEventListener('input', (e) => {
  // Only allow letters, numbers, and hyphens
  e.target.value = e.target.value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
});

// Preview functionality
previewBtn.addEventListener('click', () => {
  if (!markdownTextarea.value.trim()) {
    alert('Please enter some markdown content first');
    return;
  }
  
  if (isPreviewVisible) {
    // Hide preview
    previewContainer.classList.add('hidden');
    previewText.textContent = 'Show Preview';
    isPreviewVisible = false;
  } else {
    // Show preview
    try {
      const html = md.render(markdownTextarea.value);
      previewContent.innerHTML = html;
      previewContainer.classList.remove('hidden');
      previewText.textContent = 'Hide Preview';
      isPreviewVisible = true;
      
      // Highlight code blocks
      previewContainer.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
    } catch (error) {
      console.error('Preview error:', error);
      alert('Error rendering preview');
    }
  }
});

// Form submission with better error handling
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const markdown = markdownTextarea.value.trim();
  if (!markdown) {
    showError('Please enter some markdown content');
    return;
  }
  
  const slug = slugInput.value.trim();
  
  // Disable button during submission
  publishBtn.disabled = true;
  const originalText = publishBtn.textContent;
  publishBtn.textContent = 'Publishing...';
  
  // Hide previous results
  resultContainer.classList.add('hidden');
  
  try {
    const response = await fetch('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ markdown, slug })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Show success result with improved styling
      const fullUrl = `${window.location.origin}${result.url}`;
      resultUrl.textContent = fullUrl;
      resultContainer.classList.remove('hidden');
      
      // Update visit button
      visitBtn.onclick = () => window.open(result.url, '_blank');
      
      // Smooth scroll to result
      setTimeout(() => {
        resultContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      
      // Clear form on success
      markdownTextarea.value = '';
      slugInput.value = '';
      if (isPreviewVisible) {
        previewBtn.click(); // Hide preview
      }
      
    } else {
      // Handle specific error cases
      let errorMessage = result.error;
      if (result.suggestion) {
        errorMessage += `\n\n${result.suggestion}`;
      }
      showError(errorMessage);
    }
    
  } catch (error) {
    console.error('Publish error:', error);
    if (error.name === 'TypeError' && !navigator.onLine) {
      showError('No internet connection. Please check your network and try again.');
    } else {
      showError('Failed to publish article. Please try again.');
    }
  } finally {
    publishBtn.disabled = false;
    publishBtn.textContent = originalText;
  }
});

// Copy URL functionality
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultUrl.textContent);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  } catch (error) {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = resultUrl.textContent;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy URL';
    }, 2000);
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + Enter to publish
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    uploadForm.dispatchEvent(new Event('submit'));
  }
  
  // Ctrl/Cmd + P to toggle preview
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    previewBtn.click();
  }
});

// Initialize highlight.js
hljs.highlightAll();