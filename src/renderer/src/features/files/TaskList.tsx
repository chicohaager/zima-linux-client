import { useTranslation } from 'react-i18next'
import { Card, Muted } from '../../shared/ui/Card'
import { Badge } from '../../shared/ui/Controls'

interface Task {
  readonly id: number
  readonly type: string
  readonly status: string
  readonly errorMessage: string | null
}

/**
 * Server-side operations in flight.
 *
 * Copy and move are asynchronous tasks on ZimaOS, so the client shows the device's own status
 * word rather than a spinner: `processing`, `finished`, `error` come from the API and mean
 * something the user can act on. A task that failed carries the device's message, because
 * "error" alone leaves nowhere to go.
 *
 * Renders nothing when there is nothing running — an empty panel labelled "tasks" would
 * suggest the feature is broken.
 */
export const TaskList = ({ tasks }: { readonly tasks: readonly Task[] }): React.JSX.Element | null => {
  const { t } = useTranslation()
  if (tasks.length === 0) return null

  return (
    <Card className="mb-4">
      <p className="mb-2 text-sm font-medium">{t('files.tasks')}</p>
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={task.status === 'finished' ? 'success' : 'neutral'}>{task.type}</Badge>
            <span style={{ color: 'var(--text-muted)' }}>{task.status}</span>
            {task.errorMessage !== null && (
              <span style={{ color: 'var(--danger)' }}>{task.errorMessage}</span>
            )}
          </li>
        ))}
      </ul>
      <Muted className="mt-2">{t('files.tasksHint')}</Muted>
    </Card>
  )
}
