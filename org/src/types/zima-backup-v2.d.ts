type ZimaBackupTaskStatus =
  | 'in_progress'
  | 'paused'
  | 'stopped'
  | 'error'
  | 'complete'

interface ZimaBackupTask {
  task_id: string
  name?: string
  source_path: string
  dest_path: string
  filters: string
  keep_revision: boolean
  last_backup_time: number
  total_size: number
  total_files: number
  xferred_size: number
  xferred_files: number
  status: ZimaBackupTaskStatus
  speed?: number // only for progress message, not in task list message.
}

interface ZimaBackupDeviceInfo {
  client_name: string
  host: string
  port: number
  token: string
  refresh_token?: string
  is_tb?: boolean
}

// ==============================
//
// ZimaBackupMessage
//
// ==============================

interface ZimaBackupBaseMessage {
  op: string
}

//
// ZimaBackup => ZimaClient
//

interface ZimaBackupProgressMessage extends ZimaBackupBaseMessage {
  op: 'progress'
  speed: number
  task_id: string
  source_path: string
  total_size: number
  total_files: number
  xferred_size: number
  xferred_files: number
}

interface ZimaBackupCompleteMessage extends ZimaBackupBaseMessage {
  op: 'complete'
  task_id: string
  source_path: string
  total_size: number
  total_files: number
  xferred_size: number
  xferred_files: number
}

interface ZimaBackupErrorMessage extends ZimaBackupBaseMessage {
  op: 'error'
  code: number
  message: string
}

interface ZimaBackupListMessage extends ZimaBackupBaseMessage {
  op: 'list'
  tasks: ZimaBackupTask[]
}

interface ZimaBackupStatusChangeMessage extends ZimaBackupBaseMessage {
  op: 'status_change'
  task_id: string
  status: ZimaBackupTaskStatus | 'created' | 'deleted'
}

interface ZimaBackupKeepRevisionChangeMessage extends ZimaBackupBaseMessage {
  op: 'keep_revision_change'
  task_id: string
  action: boolean
}

//
// ZimaClient => ZimaBackup
//

interface ZimaBackupDeviceChangeMessage
  extends ZimaBackupBaseMessage, Partial<ZimaBackupDeviceInfo> {
  op: 'dev_change'
}

interface ZimaBackupListBackupsMessage extends ZimaBackupBaseMessage {
  op: 'list'
}

interface ZimaBackupCreateBackupMessage extends ZimaBackupBaseMessage {
  op: 'create'
  source_path: string
  dest_path: string
  filters?: string
}

interface ZimaBackupDeleteBackupMessage extends ZimaBackupBaseMessage {
  op: 'delete'
  task_id: string
}

interface ZimaBackupPauseMessage extends ZimaBackupBaseMessage {
  op: 'pause'
  task_id: string
}

interface ZimaBackupResumeMessage extends ZimaBackupBaseMessage {
  op: 'resume'
  task_id: string
}

interface ZimaBackupKeepRevisionMessage extends ZimaBackupBaseMessage {
  op: 'keep_revision'
  action: boolean
  task_id: string
}

interface ZimaBackupListenStatusChangeMessage extends ZimaBackupBaseMessage {
  op: 'status_change'
  action: boolean
}

interface ZimaBackupListenProgressMessage extends ZimaBackupBaseMessage {
  op: 'progress'
  action: boolean
}

interface ZimaBackupExitMessage extends ZimaBackupBaseMessage {
  op: 'exit'
}

//
// Debug
//

interface ZimaBackupLogMessage extends ZimaBackupBaseMessage {
  op: 'log'
  action: boolean
}

interface ZimaBackupInfoMessage extends ZimaBackupBaseMessage {
  op: 'info'
  log: string
}

//
// All Message
//

type ZimaBackupMessage =
  | ZimaBackupProgressMessage
  | ZimaBackupCompleteMessage
  | ZimaBackupErrorMessage
  | ZimaBackupListMessage
  | ZimaBackupStatusChangeMessage
  | ZimaBackupKeepRevisionChangeMessage
  | ZimaBackupDeviceChangeMessage
  | ZimaBackupCreateBackupMessage
  | ZimaBackupDeleteBackupMessage
  | ZimaBackupPauseMessage
  | ZimaBackupResumeMessage
  | ZimaBackupKeepRevisionMessage
  | ZimaBackupListenStatusChangeMessage
  | ZimaBackupExitMessage
  | ZimaBackupLogMessage
  | ZimaBackupInfoMessage
  | ZimaBackupListBackupsMessage
  | ZimaBackupListenProgressMessage

//
// Event Map
//

interface ZimaBackupEventMap {
  progress: ZimaBackupProgressMessage
  complete: ZimaBackupCompleteMessage
  error: ZimaBackupErrorMessage
  list: ZimaBackupListMessage
  status_change: ZimaBackupStatusChangeMessage
  keep_revision_change: ZimaBackupKeepRevisionChangeMessage
}

//
// Event
//

type ZimaBackupEvent = keyof ZimaBackupEventMap
