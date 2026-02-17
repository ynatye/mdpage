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

// File drop functionality
dropZone.addEventListener('click', () => {
  fileInput.click();
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
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

// Handle file reading
function handleFile(file) {
  if (!file.name.match(/\.(md|markdown|txt)$/i)) {
    alert('Please select a markdown file (.md, .markdown, or .txt)');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    markdownTextarea.value = e.target.result;
    
    // Auto-generate slug from first heading if slug is empty
    if (!slugInput.value.trim()) {
      const title = extractTitle(e.target.result);
      if (title !== 'Untitled') {
        slugInput.value = generateSlug(title);
      }
    }
  };
  reader.readAsText(file);
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

// Form submission
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const markdown = markdownTextarea.value.trim();
  if (!markdown) {
    alert('Please enter some markdown content');
    return;
  }
  
  const slug = slugInput.value.trim();
  
  // Disable button during submission
  publishBtn.disabled = true;
  publishBtn.textContent = 'Publishing...';
  
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
      // Show success result
      const fullUrl = `${window.location.origin}${result.url}`;
      resultUrl.textContent = fullUrl;
      resultContainer.classList.remove('hidden');
      
      // Update visit button
      visitBtn.onclick = () => window.open(result.url, '_blank');
      
      // Scroll to result
      resultContainer.scrollIntoView({ behavior: 'smooth' });
      
    } else {
      alert(`Publication failed: ${result.error}`);
    }
    
  } catch (error) {
    console.error('Publish error:', error);
    alert('Failed to publish article. Please try again.');
  } finally {
    publishBtn.disabled = false;
    publishBtn.textContent = 'Publish Article';
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