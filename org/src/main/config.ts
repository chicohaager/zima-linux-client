import os from 'node:os'
import { platform } from '@electron-toolkit/utils'
import { currentPhase, isTesting } from '@utils/phase'
import Store from 'electron-store'
import { random } from 'lodash-es'

export const Config = new Store<ConfigSchema>({
  defaults: {
    hostname: os.hostname().split('.')[0] || (platform.isMacOS ? 'Mac' : platform.isWindows ? 'Windows' : 'Client'),
    initialized: false,
    language: 'system',
    theme: 'system',
    device: {},
    connection: {},
    updateChannel: currentPhase,
    // For Testing Phase
    testing: isTesting
      ? {
          ui: [0, 1, 1][random(0, 2)],
        }
      : {},
  },
})

if (!isTesting) {
  Config.delete('testing')
}
