import { useState } from 'react'
import { AppShell } from './AppShell'
import { DeviceScreen } from '../features/devices/DeviceScreen'
import { FilesScreen } from '../features/files/FilesScreen'
import { PhotosScreen } from '../features/photos/PhotosScreen'
import { AppsScreen } from '../features/apps/AppsScreen'
import { KeyringBanner } from '../features/settings/KeyringBanner'
import { useTheme } from './useTheme'
import type { Section } from './sections'

/**
 * Four destinations, matching the mobile client: Files, Photos and Apps in the
 * floating pill, with the device as its own separated button.
 */
export const App = (): React.JSX.Element => {
  const [section, setSection] = useState<Section>('device')
  const theme = useTheme()

  return (
    <AppShell section={section} onSectionChange={setSection} theme={theme}>
      <KeyringBanner />
      {section === 'device' && <DeviceScreen />}
      {section === 'files' && <FilesScreen />}
      {section === 'photos' && <PhotosScreen />}
      {section === 'apps' && <AppsScreen />}
    </AppShell>
  )
}
