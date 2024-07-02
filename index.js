const { app, BrowserWindow, ipcMain, Menu, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { findExtraBytes, removeExtraBytes } = require('./cleaner');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let helpWindow;
let aboutWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 800,
    minWidth: 390,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: isDev // Only enable DevTools in development
    },
  });

  mainWindow.loadFile('index.html');

  // Optional: Automatically open DevTools in dev mode
  // if (isDev) {
  //   mainWindow.webContents.openDevTools();
  // }

  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile', 'multiSelections'],
              filters: [
                { name: 'Videos', extensions: ['mp4', 'mov', 'wmv'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            });
            console.log('Open dialog result:', result);
            if (!result.canceled && result.filePaths.length > 0) {
              console.log('Selected file paths:', result.filePaths);
              mainWindow.webContents.send('files-selected', result.filePaths);
            }
          }
        },
        {
          label: 'Clear File List',
          click: () => {
            mainWindow.webContents.send('clear-file-list');
          }
        },
        { type: 'separator' },
        { 
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Help',
          click: createHelpWindow
        },
        {
          label: 'About',
          click: createAboutWindow
        }
      ]
    }
  ];

  // Add DevTools option only in development mode
  if (isDev) {
    const viewSubmenu = template.find(item => item.label === 'View').submenu;
    viewSubmenu.splice(2, 0, { role: 'toggleDevTools' });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createHelpWindow() {
  if (helpWindow) {
    helpWindow.focus();
    return;
  }

  const parentBounds = mainWindow.getBounds();

  helpWindow = new BrowserWindow({
    width: 540,
    height: 960,
    minWidth: 390,
    parent: mainWindow,
    modal: true,
    autoHideMenuBar: true,
    x: parentBounds.x + 20,
    y: parentBounds.y - 40,
  });

  helpWindow.loadFile('help.html');

  helpWindow.on('closed', () => {
    helpWindow = null;
  });
}

function createAboutWindow() {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  const parentBounds = mainWindow.getBounds();

  aboutWindow = new BrowserWindow({
    width: 720,
    height: 480,
    parent: mainWindow,
    modal: true,
    autoHideMenuBar: true,
    x: parentBounds.x + 20,
    y: parentBounds.y - 40,
  });

  aboutWindow.loadFile('about.html');

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  
  globalShortcut.register('CommandOrControl+Q', () => {
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('add-files', async (event, paths) => {
  try {
    const filePaths = await getVideoFiles(paths);
    for (const filePath of filePaths) {
      try {
        const result = await findExtraBytes(filePath);
        let extraBytesInfo = '';
        if (!result.isClean) {
          const buffer = Buffer.alloc(Math.min(result.extraBytes, 100));
          const fd = await fs.open(filePath, 'r');
          await fd.read(buffer, 0, buffer.length, result.fileSize - result.extraBytes);
          await fd.close();

          extraBytesInfo = buffer.toString('utf8')
            .split('')
            .map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126 ?
              `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}` :
              char)
            .join('');

          if (result.extraBytes > 100) extraBytesInfo += '...';
        }
        mainWindow.webContents.send('update-file-status', {
          filePath: path.basename(filePath),
          status: result.isClean ? 'Already clean' : `${result.extraBytes} extra bytes`,
          clean: result.isClean,
          extraBytes: extraBytesInfo
        });
      } catch (error) {
        if (isDev) {
          console.error(`Error processing file ${filePath}:`, error);
        }
        mainWindow.webContents.send('update-file-status', {
          filePath: path.basename(filePath),
          status: 'Error processing file',
          clean: false,
        });
      }
    }
  } catch (error) {
    if (isDev) {
      console.error('Error processing files:', error);
    }
    mainWindow.webContents.send('processing-error', 'An error occurred while processing files.');
  }
});

// Utility function to get video files
async function getVideoFiles(paths) {
  const videoFiles = [];
  for (const filePath of paths) {
    const stats = await fs.stat(filePath);
    if (stats.isFile() && isVideoFile(filePath)) {
      videoFiles.push(filePath);
    }
  }
  return videoFiles;
}

function isVideoFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.mp4', '.mov', '.wmv'].includes(ext);
}

ipcMain.on('clean-files', async (event, { files, saveBytes }) => {
  for (const file of files) {
    try {
      const result = await removeExtraBytes(file.path, saveBytes);
      mainWindow.webContents.send('update-file-status', {
        filePath: file.name,
        status: result.cleaned ? 'Cleaned' : 'Already clean',
        clean: true,
      });
    } catch (error) {
      console.error(`Error cleaning file ${file.path}:`, error);
      mainWindow.webContents.send('update-file-status', {
        filePath: file.name,
        status: 'Error cleaning',
        clean: false,
      });
    }
  }
  mainWindow.webContents.send('files-cleaned');
});

ipcMain.on('open-help-window', () => {
  createHelpWindow();
});

// Additional utility functions and event handlers

// Function to handle opening files or folders
async function handleFileOpen(filePaths) {
  const videoFiles = await getVideoFiles(filePaths);
  mainWindow.webContents.send('files-selected', videoFiles);
}

// Event listener for when files are dropped onto the app icon (macOS)
app.on('will-finish-launching', () => {
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow) {
      handleFileOpen([filePath]);
    } else {
      app.on('ready', () => {
        handleFileOpen([filePath]);
      });
    }
  });
});

// If in development mode, install developer tools
if (isDev) {
  app.whenReady().then(() => {
    const { default: installExtension, REACT_DEVELOPER_TOOLS } = require('electron-devtools-installer');
    installExtension(REACT_DEVELOPER_TOOLS)
      .then((name) => console.log(`Added Extension: ${name}`))
      .catch((err) => console.log('An error occurred: ', err));
  });
}

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // You might want to show an error dialog to the user here
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('uncaught-error', error.message);
  }
});

// Remove devtools in production
app.on('ready', () => {
  if (!isDev) {
    globalShortcut.register('Control+Shift+I', () => {
      return false;
    });
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});