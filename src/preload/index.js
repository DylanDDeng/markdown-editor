const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') {
    return () => {};
  }
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

contextBridge.exposeInMainWorld('markdownAPI', {
  onNewFile: (callback) => subscribe('command:new-file', callback),
  onOpenCommand: (callback) => subscribe('command:open-file', callback),
  onSaveCommand: (callback) => subscribe('command:save-file', callback),
  onSaveAsCommand: (callback) => subscribe('command:save-file-as', callback),
  onFileOpened: (callback) => subscribe('file-opened', callback),
  openFile: () => ipcRenderer.invoke('dialog:open-file'),
  saveFile: (payload) => ipcRenderer.invoke('dialog:save-file', payload),
  selectDirectory: () => ipcRenderer.invoke('workspace:select-directory'),
  listDirectory: (directory) => ipcRenderer.invoke('workspace:list-files', directory),
  openFileByPath: (filePath) => ipcRenderer.invoke('workspace:open-file-path', filePath),
  setWindowTitle: (title) => {
    if (typeof title === 'string') {
      ipcRenderer.send('window:set-title', title);
    }
  },
  setRepresentedFile: (filePath) => {
    ipcRenderer.send('window:set-represented-file', filePath || '');
  },
  send: (channel, payload) => {
    ipcRenderer.send(channel, payload);
  },
});
