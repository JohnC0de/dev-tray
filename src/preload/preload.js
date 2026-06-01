'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Keep in sync with src/shared/brand.js — inlined because sandboxed preload
// cannot require project modules outside this file.
const BRIDGE_NAME = 'devTray';

// Minimal, explicit bridge — no remote module, no node in the renderer.
contextBridge.exposeInMainWorld(BRIDGE_NAME, {
  // request/response
  init: () => ipcRenderer.invoke('app:init'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('settings:setLaunchAtLogin', enabled),
  setRefreshInterval: (seconds) => ipcRenderer.invoke('settings:setRefreshInterval', seconds),
  completeOnboarding: () => ipcRenderer.invoke('settings:completeOnboarding'),

  // fire-and-forget actions
  refresh: () => ipcRenderer.send('ports:refresh'),
  killPort: (pid, port) => ipcRenderer.send('port:kill', { pid, port }),
  killAll: () => ipcRenderer.send('ports:killAll'),
  openPort: (port) => ipcRenderer.send('port:open', port),
  copy: (text) => ipcRenderer.send('clipboard:write', text),
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
  quit: () => ipcRenderer.send('app:quit'),
  hideWindow: () => ipcRenderer.send('window:hide'),
  resizeWindow: (height) => ipcRenderer.send('window:resize', height),
  updateTray: (payload) => ipcRenderer.send('tray:update', payload),

  // subscriptions (main -> renderer)
  onPortsUpdate: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('ports:update', handler);
    return () => ipcRenderer.removeListener('ports:update', handler);
  },
  onWillShow: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('window:will-show', handler);
    return () => ipcRenderer.removeListener('window:will-show', handler);
  },
});
