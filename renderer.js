const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs').promises;

const isDev = process.env.NODE_ENV === 'development';

// Wrap the entire content of the file in an async IIFE to allow top-level await
(async () => {
  try {
    await new Promise(resolve => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve);
      } else {
        resolve();
      }
    });

    const dropZone = document.getElementById('dropZone');
    const fileList = document.getElementById('fileList');
    const dropText = document.getElementById('dropText');
    const fileTemplate = document.getElementById('fileTemplate');
    const fileCountElement = document.getElementById('fileCount');
    const cleanBtn = document.getElementById('cleanBtn');
    const removeCleanBtn = document.getElementById('removeCleanBtn');
    const saveBytesCheckbox = document.getElementById('saveBytes');
    const helpLink = document.getElementById('helpLink');
    const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.wmv'];

    let fileCount = 0;

    // Log the state of important DOM elements
    if (!dropZone || !fileList || !fileTemplate) {
      throw new Error('Critical DOM elements are missing.');
    }

    if (!dropZone || !fileList || !fileTemplate) {
      console.error('Critical DOM elements are missing. Aborting initialization.');
      return;
    }


    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const items = e.dataTransfer.items;
      const files = await Promise.all(Array.from(items).map(item => handleItem(item.webkitGetAsEntry())));
      handleFiles(files.flat());
    });

    async function handleItem(entry) {
      if (!entry) {
        console.warn('Received null or undefined entry');
        return [];
      }

      if (entry.isFile) {
        return new Promise(resolve => entry.file(resolve));
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const entries = await new Promise(resolve => {
          dirReader.readEntries(resolve);
        });
        const filesInDir = await Promise.all(entries.map(handleItem));
        return filesInDir.flat();
      }
      return [];
    }

    function handleFiles(files) {
      console.log('Handling files:', files.length);

      if (!fileList || !fileTemplate) {
        console.error('fileList or fileTemplate is null. Cannot process files.');
        return;
      }

      const currentFiles = new Set(Array.from(fileList.children).map(el => {
        const textElement = el.querySelector('.text-white');
        return textElement ? textElement.textContent : null;
      }));

      files.forEach(file => {
        const fileName = file.name || path.basename(file.path);
        const filePath = file.path || file.name;
        const extension = path.extname(fileName).toLowerCase();

        if (ALLOWED_EXTENSIONS.includes(extension) && !currentFiles.has(fileName)) {
          try {
            const fileElement = fileTemplate.content.cloneNode(true);

            // Detailed logging of template structure
            console.log('File template structure:', fileElement.firstElementChild.outerHTML);

            const nameElement = fileElement.querySelector('.text-white');
            const sizeElement = fileElement.querySelector('.text-neutral-400');
            const statusElement = fileElement.querySelector('.rounded-full');

            console.log('Template elements found:', {
              nameElement: !!nameElement,
              sizeElement: !!sizeElement,
              statusElement: !!statusElement
            });

            if (!nameElement || !sizeElement || !statusElement) {
              console.error('Required elements not found in file template');
              console.error('Missing elements:', {
                nameElement: !nameElement,
                sizeElement: !sizeElement,
                statusElement: !statusElement
              });
              return;
            }

            nameElement.textContent = fileName;
            sizeElement.textContent = formatFileSize(file.size);
            statusElement.textContent = 'Pending';
            statusElement.classList.add('bg-yellow-900', 'text-yellow-200');

            fileElement.firstElementChild.dataset.path = filePath;

            fileList.appendChild(fileElement);
            fileCount++;
            currentFiles.add(fileName);
          } catch (error) {
            console.error('Error adding file to list:', error);
          }
        }
      });

      updateFileCount();
      updateDropZoneVisibility();
      ipcRenderer.send('add-files', files.map(f => f.path || f.name));
    }

    function formatFileSize(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function updateFileCount() {
      fileCountElement.textContent = fileCount;
    }

    function updateDropZoneVisibility() {
      if (fileCount === 0) {
        dropText.classList.remove('hidden');
        fileList.classList.add('hidden');
      } else {
        dropText.classList.add('hidden');
        fileList.classList.remove('hidden');
      }
    }

    function removeCleanFiles() {
      const fileElements = Array.from(fileList.children);
      fileElements.forEach(el => {
        const statusElement = el.querySelector('.rounded-full');
        if (statusElement.classList.contains('bg-green-900')) {
          fileList.removeChild(el);
          fileCount--;
        }
      });
      updateFileCount();
      updateDropZoneVisibility();
    }

    function escapeHtml(unsafe) {
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    cleanBtn.addEventListener('click', () => {
      const filesToClean = Array.from(fileList.children)
        .filter(el => !el.querySelector('.rounded-full').classList.contains('bg-green-900'))
        .map(el => ({
          name: el.querySelector('.text-white').textContent,
          path: el.dataset.path
        }));

      if (filesToClean.length > 0) {
        ipcRenderer.send('clean-files', {
          files: filesToClean,
          saveBytes: saveBytesCheckbox.checked
        });
      }
    });

    removeCleanBtn.addEventListener('click', () => {
      removeCleanFiles();
    });

    helpLink.addEventListener('click', (e) => {
      e.preventDefault();
      ipcRenderer.send('open-help-window');
    });

    ipcRenderer.on('update-file-status', (event, { filePath, status, clean, extraBytes }) => {
      const fileElements = fileList.children;
      for (let i = 0; i < fileElements.length; i++) {
        const nameElement = fileElements[i].querySelector('.text-white');
        if (nameElement.textContent === filePath) {
          const statusElement = fileElements[i].querySelector('.rounded-full');
          statusElement.textContent = status;
          statusElement.className = 'px-3 py-1 rounded-full text-xs font-medium truncate max-w-[200px] cursor-help ' +
            (clean ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200');

          if (extraBytes) {
            const escapedExtraBytes = escapeHtml(extraBytes);
            statusElement.title = `Extra bytes: ${escapedExtraBytes}`;
          } else {
            statusElement.title = '';
          }

          break;
        }
      }
    });

    ipcRenderer.on('files-selected', async (event, filePaths) => {
      const files = await Promise.all(filePaths.map(async (filePath) => {
        const stats = await fs.stat(filePath);
        return {
          name: path.basename(filePath),
          path: filePath,
          size: stats.size
        };
      }));
      handleFiles(files);
    });

    ipcRenderer.on('clear-file-list', () => {
      fileList.innerHTML = '';
      fileCount = 0;
      updateFileCount();
      updateDropZoneVisibility();
    });

    ipcRenderer.on('files-cleaned', () => {
      // You can add any post-cleaning logic here if needed
    });

    ipcRenderer.on('processing-error', (event, message) => {
      // Display error message to user (e.g., using a modal or notification)
      alert(message);
    });

    ipcRenderer.on('uncaught-error', (event, message) => {
      // Display error message to user
      alert(message);
    });

    // Debounce function
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    // Use debounced version of handleFiles if needed
    const debouncedHandleFiles = debounce(handleFiles, 300);

  } catch (error) {
    if (isDev) {
      console.error('Error initializing renderer:', error);
    }
    // Display a user-friendly error message
    alert('An error occurred while starting the application. Please try again.');
  }
})();