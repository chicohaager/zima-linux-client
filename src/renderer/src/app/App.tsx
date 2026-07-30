import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppShell } from './AppShell'
import { DeviceScreen } from '../features/devices/DeviceScreen'
import { PlaceholderScreen } from '../shared/ui/PlaceholderScreen'
import { KeyringBanner } from '../features/settings/KeyringBanner'
import { useTheme } from './useTheme'
import type { Section } from './sections'

/**
 * Four destinations, matching the mobile client: Files, Photos and Apps in the
 * floating pill, with the device as its own separated button.
 */
export const App = (): React.JSX.Element => {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('device')
  const theme = useTheme()

  return (
    <AppShell section={section} onSectionChange={setSection} theme={theme}>
      <KeyringBanner />
      {section === 'device' && <DeviceScreen />}
      {section === 'files' && <PlaceholderScreen title={t('files.title')} phase="4" />}
      {section === 'photos' && <PlaceholderScreen title={t('photos.title')} phase="5" />}
      {section === 'apps' && <PlaceholderScreen title={t('apps.title')} phase="6" />}
    </AppShell>
  )
}
