import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { Card, Muted } from '../../shared/ui/Card'
import { Button } from '../../shared/ui/Controls'
import { unwrap } from '../../shared/lib/ipc'

/**
 * Opens the log directory in the file manager.
 *
 * Small, but it is the difference between "please send me your logs" and someone being able
 * to. The path is shown after the click, because on some desktops nothing visibly happens and
 * the user needs to know where to look.
 */
export const LogFolderButton = (): React.JSX.Element => {
  const { t } = useTranslation()
  const open = useMutation({
    mutationFn: async () => unwrap(await window.zima.openLogFolder({})),
  })

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{t('logs.title')}</p>
        <Button variant="secondary" className="ml-auto" onClick={() => open.mutate()}>
          {t('logs.open')}
        </Button>
      </div>
      {open.data !== undefined && (
        <Muted className="mt-2 font-mono text-xs">{open.data.folder}</Muted>
      )}
    </Card>
  )
}
