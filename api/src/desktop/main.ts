import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  ipcMain,
  nativeImage,
  session,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import type { FastifyInstance } from 'fastify';
import type { NotificationMessage, Notifier } from '../modules/notifications/notifier.js';
import { DESKTOP_COOKIE } from '../shared/desktop-lock.js';
import { startApi } from '../start.js';
import { loadOrMakeKey } from './key.js';

/**
 * The desktop app (plan 7.4): the API in this process, on this PC only, behind the launch's secret;
 * one window showing the Angular build from there; the system's own notifications; an icon in the
 * tray, so closing the window keeps the checks for new tickets running.
 *
 *   --hidden  started with Windows: the tray icon only, until the user opens the window
 *   --smoke   start, load the window unseen, check it, quit (exit code 0: it works)
 */

const APP_ID = 'dev.lenzi.vtiger-reader';
const NAME = 'vtiger reader';
/** dist/desktop/ (or the same inside app.asar), then the app's root: api/ in development. */
const here = fileURLToPath(new URL('.', import.meta.url));
const appRoot = join(here, '..', '..');
const smoke = process.argv.includes('--smoke');
const startHidden = process.argv.includes('--hidden');
/** The window's background before the page paints: the theme's surface (web/src/material-theme.scss). */
const SURFACE = '#1f1f22';

// The profile folder: the database, the sealing key, the log. Development keeps its own.
const dataDir =
  process.env['VTIGER_READER_DATA'] || join(app.getPath('appData'), app.isPackaged ? 'vtiger-reader' : 'vtiger-reader-dev');
app.setPath('userData', dataDir);
app.setName(NAME);
// Windows shows notifications under this id (the installer's shortcut carries the same).
app.setAppUserModelId(APP_ID);

let api: FastifyInstance | null = null;
let baseUrl = '';
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let toldAboutTray = false;
/** The notifications on screen, by tag: kept so that a click still reaches them, replaced by a newer one. */
const onScreen = new Map<string, Notification>();

const asset = (name: string) => join(appRoot, 'assets', name);
const webDist = () => (app.isPackaged ? join(process.resourcesPath, 'web') : join(appRoot, '..', 'web', 'dist', 'web', 'browser'));
const log = (message: string) => (api ? api.log.warn(message) : console.warn(message));

/** A path of the app itself ('/tickets/17x1'), never another site ('//evil', 'https:'). */
function isAppPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/** What only the app's own pages may ask the main process. */
function fromOurPage(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url === baseUrl || url.startsWith(`${baseUrl}/`);
}

/** The system's notifications (plan 7.2): a click opens the ticket in the window. */
const notifier: Notifier = {
  show(_owner, message: NotificationMessage): boolean {
    if (!Notification.isSupported()) return false;
    onScreen.get(message.tag)?.close();
    const notification = new Notification({ title: message.title, body: message.body, icon: asset('icon.png') });
    notification.on('click', () => open(message.url));
    notification.on('close', () => {
      if (onScreen.get(message.tag) === notification) onScreen.delete(message.tag);
    });
    onScreen.set(message.tag, notification);
    notification.show();
    return true;
  },
};

/** Only the app in the window; links to other sites open in the default browser. */
function lockNavigation(contents: WebContents): void {
  const ours = (url: string) => url === baseUrl || url.startsWith(`${baseUrl}/`);
  const outside = (url: string) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
  };
  contents.on('will-navigate', (event, url) => {
    if (ours(url)) return;
    event.preventDefault();
    outside(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    // A file of a ticket opened apart: a plain window of the app, with no bridge to the main process.
    if (ours(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: SURFACE,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    outside(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function createWindow(path: string): BrowserWindow {
  const created = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: NAME,
    icon: asset('icon.png'),
    backgroundColor: SURFACE,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  created.removeMenu();
  lockNavigation(created.webContents);
  created.once('ready-to-show', () => {
    if (!smoke) created.show();
  });
  // Closing the window keeps the app in the tray: the checks go on.
  created.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    created.hide();
    if (!toldAboutTray && Notification.isSupported()) {
      toldAboutTray = true;
      new Notification({
        title: NAME,
        body: 'Still running in the tray, to tell you about new tickets. Quit it from the tray icon.',
        icon: asset('icon.png'),
      }).show();
    }
  });
  created.on('closed', () => {
    if (mainWindow === created) mainWindow = null;
  });
  void created.loadURL(`${baseUrl}${isAppPath(path) ? path : '/'}`);
  return created;
}

/** The window, shown and in front (made when there is none). */
function showWindow(path = '/'): BrowserWindow {
  if (!mainWindow) {
    mainWindow = createWindow(path);
    return mainWindow;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

/** Opens a page of the app in the window: in the open page, without reloading it. */
function open(path: string): void {
  const existed = mainWindow !== null;
  const shown = showWindow(path);
  if (existed && isAppPath(path)) shown.webContents.send('vtiger:open', path);
}

function loginItem(): { path: string; args: string[] } {
  // In development the app is electron.exe with this folder; installed, the app's own .exe.
  return app.isPackaged ? { path: process.execPath, args: ['--hidden'] } : { path: process.execPath, args: [app.getAppPath(), '--hidden'] };
}

function wireIpc(): void {
  ipcMain.handle('vtiger:start-at-login:get', (event) => {
    if (!fromOurPage(event)) return false;
    return app.getLoginItemSettings(loginItem()).openAtLogin;
  });
  ipcMain.handle('vtiger:start-at-login:set', (event, on: unknown) => {
    if (!fromOurPage(event)) return false;
    app.setLoginItemSettings({ ...loginItem(), openAtLogin: on === true });
    return app.getLoginItemSettings(loginItem()).openAtLogin;
  });
}

function makeTray(): Tray {
  const made = new Tray(nativeImage.createFromPath(asset('tray.png')));
  made.setToolTip(NAME);
  made.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${NAME}`, click: () => showWindow() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  made.on('click', () => showWindow());
  return made;
}

async function start(): Promise<void> {
  Menu.setApplicationMenu(null);
  mkdirSync(join(dataDir, 'logs'), { recursive: true });
  const key = loadOrMakeKey(dataDir, (message) => console.warn(message));
  // A new secret at every start: only this window will have it (shared/desktop-lock.ts).
  const token = randomBytes(32).toString('base64url');
  const started = await startApi({
    dbFile: join(dataDir, 'vtiger-reader.db'),
    host: '127.0.0.1',
    port: 0,
    webDist: webDist(),
    logger: app.isPackaged ? { level: 'warn', file: join(dataDir, 'logs', 'app.log') } : { level: 'info' },
    appUrl: 'http://127.0.0.1',
    crm: { encryptionKey: key },
    ai: { anyAddress: true },
    notifier,
    desktopToken: token,
  });
  api = started.app;
  baseUrl = started.url;
  // A session cookie (gone when the app quits), for this address only, out of the page's reach.
  await session.defaultSession.cookies.set({ url: baseUrl, name: DESKTOP_COOKIE, value: token, httpOnly: true, sameSite: 'strict' });
  // The page may copy to the clipboard (the AI's draft); nothing else (camera, location, …).
  session.defaultSession.setPermissionRequestHandler((_contents, permission, done) => done(permission === 'clipboard-sanitized-write'));
  wireIpc();
  tray = makeTray();
  if (!startHidden || smoke) mainWindow = createWindow('/');
  if (smoke) await runSmoke();
}

/** --smoke: the window loads the app from the API, the bridge is there, the lock holds. Then quits. */
async function runSmoke(): Promise<void> {
  const page = mainWindow!.webContents;
  if (page.isLoading()) await new Promise<void>((resolve) => page.once('did-finish-load', () => resolve()));
  const seen = (await page.executeJavaScript(
    `new Promise((resolve) => {
       const started = Date.now();
       const look = () => {
         const text = document.querySelector('app-tickets-page')?.textContent ?? '';
         if (text.includes('CRM') || Date.now() - started > 20000) {
           resolve({ title: document.title, text: text.replace(/\\s+/g, ' ').slice(0, 160), bridge: typeof window.vtigerDesktop });
         } else setTimeout(look, 200);
       };
       look();
     })`,
  )) as { title: string; text: string; bridge: string };
  const locked = (await fetch(`${baseUrl}/api/health`)).status;
  const health = await page.executeJavaScript(`fetch('/api/health').then((r) => r.json())`);
  const ok = seen.text.includes('CRM') && seen.bridge === 'object' && locked === 403 && (health as { status?: string }).status === 'ok';
  console.log(`SMOKE ${ok ? 'OK' : 'FAILED'} ${JSON.stringify({ ...seen, lockedWithoutCookie: locked, health, notifications: Notification.isSupported() })}`);
  process.exitCode = ok ? 0 : 1;
  quitting = true;
  app.quit();
}

if (!smoke && !app.requestSingleInstanceLock()) {
  // Already running: that one comes to the front (second-instance), this one goes.
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  // Every window closed: the app stays, in the tray.
  app.on('window-all-closed', () => undefined);
  app.on('before-quit', () => {
    quitting = true;
  });
  // The API (and the database) closes before the app goes.
  app.on('will-quit', (event) => {
    if (!api) return;
    event.preventDefault();
    const closing = api;
    api = null;
    tray?.destroy();
    // Then out at once: a second app.quit() here would be ignored.
    void closing
      .close()
      .catch((err: unknown) => console.error('closing the API failed', err))
      .finally(() => app.exit(typeof process.exitCode === 'number' ? process.exitCode : 0));
  });
  app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      log(`the app could not start: ${(err as Error).stack ?? String(err)}`);
      console.error(err);
      process.exitCode = 1;
      quitting = true;
      app.quit();
    });
}
