const ipcRenderer = window.electron.ipcRenderer

export function openExternal(url: string): void {
  ipcRenderer.invoke('shell:openExternal', url)
}

export function openPath(path: string): void {
  ipcRenderer.invoke('shell:openPath', path)
}

export function showItemInFolder(path: string): void {
  ipcRenderer.invoke('shell:showItemInFolder', path)
}
