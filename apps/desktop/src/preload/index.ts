import { contextBridge, ipcRenderer } from 'electron';

// Do not import @dev-tray/core here. Bundling it into preload breaks bridge init in dev.
const BRIDGE_NAME = 'devTray';

contextBridge.exposeInMainWorld(BRIDGE_NAME, {
  init: () => ipcRenderer.invoke('app:init'),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke('settings:setLaunchAtLogin', enabled),
  setRefreshInterval: (seconds: number) => ipcRenderer.invoke('settings:setRefreshInterval', seconds),
  completeOnboarding: () => ipcRenderer.invoke('settings:completeOnboarding'),

  refresh: () => ipcRenderer.send('ports:refresh'),
  killPort: (pid: number, port: number) => ipcRenderer.send('port:kill', { pid, port }),
  killAll: () => ipcRenderer.send('ports:killAll'),
  openPort: (port: number) => ipcRenderer.send('port:open', port),
  copy: (text: string) => ipcRenderer.send('clipboard:write', text),
  openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),
  quit: () => ipcRenderer.send('app:quit'),
  hideWindow: () => ipcRenderer.send('window:hide'),
  resizeWindow: (height: number) => ipcRenderer.send('window:resize', height),
  dragStart: (screenX: number, screenY: number) => ipcRenderer.send('window:drag-start', { screenX, screenY }),
  dragMove: (screenX: number, screenY: number) => ipcRenderer.send('window:drag-move', { screenX, screenY }),
  dragEnd: () => ipcRenderer.send('window:drag-end'),
  getBounds: () => ipcRenderer.invoke('window:get-bounds'),
  updateTray: (payload: { dataURL?: string; tooltip?: string }) => ipcRenderer.send('tray:update', payload),

  onPortsUpdate: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on('ports:update', handler);
    return () => ipcRenderer.removeListener('ports:update', handler);
  },
  onWillShow: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('window:will-show', handler);
    return () => ipcRenderer.removeListener('window:will-show', handler);
  },
});
