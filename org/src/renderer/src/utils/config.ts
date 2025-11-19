const ipcRenderer = window.electron.ipcRenderer

export class Config {
  public static async get(key: ConfigSchemaKeys, defaultValue?: string): Promise<any> {
    return await ipcRenderer.invoke('config:get', key, defaultValue)
  }

  public static async set(key: ConfigSchemaKeys, value: any): Promise<void> {
    return await ipcRenderer.invoke('config:set', key, value)
  }

  public static async delete(key: ConfigSchemaKeys): Promise<void> {
    return await ipcRenderer.invoke('config:delete', key)
  }

  public static async store(): Promise<any> {
    return await ipcRenderer.invoke('config:store')
  }

  public static async clear(): Promise<void> {
    return await ipcRenderer.invoke('config:clear')
  }
}
