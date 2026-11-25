const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const isSmokeTest = process.env.PDF_TOOLS_SMOKE_TEST === '1';

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: !isSmokeTest,
    backgroundColor: '#09090b',
    titleBarStyle: 'default',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  if (isSmokeTest) {
    const timer = setTimeout(() => {
      console.error('[smoke-test] Timed out waiting for window to load');
      app.exit(1);
    }, 30000);

    mainWindow.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      console.log('[smoke-test] Window loaded successfully');
      app.exit(0);
    });

    mainWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      clearTimeout(timer);
      console.error(`[smoke-test] Failed to load window: ${errorCode} ${errorDescription}`);
      app.exit(1);
    });

    mainWindow.webContents.once('render-process-gone', (_event, details) => {
      clearTimeout(timer);
      console.error(`[smoke-test] Renderer process gone: ${details.reason}`);
      app.exit(1);
    });
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
