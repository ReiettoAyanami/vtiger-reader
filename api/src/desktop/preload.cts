// The bridge between the desktop app's window and its main process (plan 7.4). The page runs
// sandboxed, with no Node: it gets only these three calls, as window.vtigerDesktop.
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld('vtigerDesktop', {
  /** A notification was clicked: the page it opens ('/tickets/17x1'). */
  onOpen(listener: (path: string) => void): void {
    ipcRenderer.on('vtiger:open', (_event, path: unknown) => {
      if (typeof path === 'string') listener(path);
    });
  },
  /** Does the app start with Windows (in the tray)? */
  getStartAtLogin(): Promise<boolean> {
    return ipcRenderer.invoke('vtiger:start-at-login:get') as Promise<boolean>;
  },
  setStartAtLogin(on: boolean): Promise<boolean> {
    return ipcRenderer.invoke('vtiger:start-at-login:set', on === true) as Promise<boolean>;
  },
});
