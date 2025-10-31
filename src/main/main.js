const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const isMac = process.platform === 'darwin';
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_NAME = '涌现 Emergence';

const markdownExtensions = new Set(['.md', '.markdown', '.mdx', '.txt']);

const markdownFilters = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] },
  { name: 'All Files', extensions: ['*'] },
];

const getBrowserWindowFromEvent = (event) => BrowserWindow.fromWebContents(event.sender);

const reportFileError = (error, context = '文件操作失败') => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(context, error);
  dialog.showErrorBox(context, message);
};

const setWindowRepresentedFile = (browserWindow, filePath) => {
  if (isMac && browserWindow && typeof browserWindow.setRepresentedFilename === 'function') {
    browserWindow.setRepresentedFilename(filePath || '');
  }
};

const listMarkdownFilesInDirectory = async (directoryPath) => {
  const entries = await fsPromises.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (markdownExtensions.has(ext)) {
          files.push({
            name: entry.name,
            path: path.join(directoryPath, entry.name),
          });
        }
        return;
      }

      if (entry.isSymbolicLink()) {
        try {
          const linkTarget = await fsPromises.stat(path.join(directoryPath, entry.name));
          if (linkTarget.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (markdownExtensions.has(ext)) {
              files.push({
                name: entry.name,
                path: path.join(directoryPath, entry.name),
              });
            }
          }
        } catch (error) {
          console.warn('Failed to resolve symbolic link', error);
        }
      }
    })
  );

  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return files;
};

const openFileFromDialog = async (browserWindow) => {
  if (!browserWindow) {
    return { canceled: true };
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(browserWindow, {
    properties: ['openFile'],
    filters: markdownFilters,
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = filePaths[0];
  const content = await fsPromises.readFile(filePath, 'utf8');

  setWindowRepresentedFile(browserWindow, filePath);

  return { canceled: false, filePath, content };
};

const saveFileToDisk = async (browserWindow, { filePath, content }) => {
  if (!browserWindow) {
    return { canceled: true };
  }

  let targetPath = filePath;

  if (!targetPath) {
    const { canceled, filePath: pickedPath } = await dialog.showSaveDialog(browserWindow, {
      defaultPath: '未命名.md',
      filters: markdownFilters,
    });

    if (canceled || !pickedPath) {
      return { canceled: true };
    }

    targetPath = pickedPath;
  }

  await fsPromises.writeFile(targetPath, content ?? '', 'utf8');
  setWindowRepresentedFile(browserWindow, targetPath);

  return { canceled: false, filePath: targetPath };
};

ipcMain.handle('dialog:open-file', async (event) => {
  const browserWindow = getBrowserWindowFromEvent(event);
  try {
    return await openFileFromDialog(browserWindow);
  } catch (error) {
    reportFileError(error, '打开文件失败');
    return { canceled: true, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('dialog:save-file', async (event, payload = {}) => {
  const browserWindow = getBrowserWindowFromEvent(event);
  try {
    return await saveFileToDisk(browserWindow, payload);
  } catch (error) {
    reportFileError(error, '保存文件失败');
    return { canceled: true, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.on('window:set-title', (event, title) => {
  const browserWindow = getBrowserWindowFromEvent(event);
  if (!browserWindow) {
    return;
  }
  if (typeof title === 'string' && title.trim().length > 0) {
    browserWindow.setTitle(title);
  } else {
    browserWindow.setTitle(APP_NAME);
  }
});

ipcMain.on('window:set-represented-file', (event, filePath) => {
  const browserWindow = getBrowserWindowFromEvent(event);
  setWindowRepresentedFile(browserWindow, filePath);
});

ipcMain.handle('workspace:select-directory', async (event) => {
  const browserWindow = getBrowserWindowFromEvent(event);
  if (!browserWindow) {
    return { canceled: true };
  }

  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(browserWindow, {
      properties: ['openDirectory'],
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { canceled: true };
    }

    const directory = filePaths[0];
    const files = await listMarkdownFilesInDirectory(directory);
    return { canceled: false, directory, files };
  } catch (error) {
    reportFileError(error, '选择目录失败');
    return { canceled: true, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('workspace:list-files', async (_event, directory) => {
  if (typeof directory !== 'string' || directory.trim().length === 0) {
    return { files: [] };
  }

  try {
    const stats = await fsPromises.stat(directory);
    if (!stats.isDirectory()) {
      return { files: [] };
    }
    const files = await listMarkdownFilesInDirectory(directory);
    return { files };
  } catch (error) {
    reportFileError(error, '读取目录失败');
    return { files: [], error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('workspace:open-file-path', async (event, filePath) => {
  const browserWindow = getBrowserWindowFromEvent(event);
  if (!browserWindow || typeof filePath !== 'string' || filePath.trim().length === 0) {
    return { canceled: true };
  }

  try {
    const stats = await fsPromises.stat(filePath);
    if (!stats.isFile()) {
      return { canceled: true, error: '目标不是文件' };
    }

    const content = await fsPromises.readFile(filePath, 'utf8');
    setWindowRepresentedFile(browserWindow, filePath);
    return { canceled: false, filePath, content };
  } catch (error) {
    reportFileError(error, '打开文件失败');
    return { canceled: true, error: error instanceof Error ? error.message : String(error) };
  }
});

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    trafficLightPosition: { x: 12, y: 12 },
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  if (DEV_SERVER_URL) {
    await mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const rendererIndexPath = path.join(__dirname, '../../dist/renderer/index.html');
    if (!fs.existsSync(rendererIndexPath)) {
      throw new Error(`Renderer bundle not found at ${rendererIndexPath}. Run "npm run build" before "npm start".`);
    }
    await mainWindow.loadFile(rendererIndexPath);

    if (process.env.ELECTRON_ENABLE_LOGGING || process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }

  return mainWindow;
}

const dispatchCommandToWindow = (command, focusedWindow) => {
  if (!command) {
    return;
  }

  if (focusedWindow) {
    focusedWindow.webContents.send(command);
    return;
  }

  createMainWindow()
    .then((window) => {
      window.webContents.once('did-finish-load', () => {
        window.webContents.send(command);
      });
    })
    .catch((error) => {
      console.error(`Failed to dispatch ${command} to new window`, error);
    });
};

function buildAppMenu() {
  const template = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideothers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Document',
          accelerator: 'CmdOrCtrl+N',
          click: (_, focusedWindow) => {
            if (!focusedWindow) {
              createMainWindow().catch((error) => {
                console.error('Failed to create main window for new document', error);
              });
              return;
            }
            focusedWindow.webContents.send('command:new-file');
          },
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: (_, focusedWindow) => {
            dispatchCommandToWindow('command:open-file', focusedWindow);
          },
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: (_, focusedWindow) => {
            dispatchCommandToWindow('command:save-file', focusedWindow);
          },
        },
        {
          label: 'Save As…',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: (_, focusedWindow) => {
            dispatchCommandToWindow('command:save-file-as', focusedWindow);
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }] : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://www.electronjs.org');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  buildAppMenu();
  createMainWindow().catch((error) => {
    console.error('Failed to create main window', error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow().catch((error) => {
        console.error('Failed to recreate main window', error);
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});
