import type { PowerShellOptions } from 'node-powershell'
import { exec } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import process from 'node:process'
import { platform } from '@electron-toolkit/utils'
import icns from '@resources/icons/zima.icns?asset&asarUnpack'
import winInstaller from '@resources/installer/zerotier/ZeroTierOne.msi?asset&asarUnpack'
import macInstaller from '@resources/installer/zerotier/ZeroTierOne.pkg?asset&asarUnpack'
import linuxZTOBin from '@resources/installer/zerotier/linux/x64/zerotier-one?asset&asarUnpack'
import linuxZTCLIBin from '@resources/installer/zerotier/linux/x64/zerotier-cli?asset&asarUnpack'
import { clearIntervalTask, clearTimeoutTask, setIntervalTask, setTimeoutTask } from '@utils/timers'
import * as sudo from '@vscode/sudo-prompt'
import { app, ipcMain } from 'electron'
import log from 'electron-log/main'
import { PowerShell } from 'node-powershell'

import { ZeroTier } from './api'

// Extend PowerShell interface with methods from child-shell base class
declare module 'node-powershell' {
  interface PowerShell {
    invoke(command: string): Promise<{ stdout?: Buffer | string; stderr?: Buffer | string }>
    dispose(): void
  }
}

const UID = process.getuid?.().toString() || process.env.UID || process.env.USER || process.env.USERNAME || (platform.isMacOS ? '501' : '1000')
const GID = process.getgid?.().toString() || process.env.GID || (platform.isMacOS ? '20' : '1000')

// const powershell = 'powershell.exe'

const macFolder = '/Library/Application Support/ZeroTier/One'
const macUserFolders = [
  `${app.getPath('home')}/Library/Application Support/ZeroTier`,
  `${app.getPath('home')}/Library/Application Support/ZeroTier/One`,
]
const macZTOPath = '/Library/Application Support/ZeroTier/One/zerotier-one'
const macPkgId = 'com.zerotier.pkg.ZeroTierOne'
const macProcessName = 'zerotier-one'
const macPlistPath = '/Library/LaunchDaemons/com.zerotier.one.plist'
const macAppPath = '/Applications/ZeroTier.app'

const winFolder = 'C:\\ProgramData\\ZeroTier\\One'
const winUserFolders = [
  `\\\\?\\${app.getPath('home')}\\AppData\\Local\\ZeroTier`,
  `\\\\?\\${app.getPath('home')}\\AppData\\Local\\ZeroTier\\One`,
]
const winDesktopUIPath = `C:\\Program Files (x86)\\ZeroTier\\One\\zerotier_desktop_ui.exe`
const winZTOPath = `C:\\ProgramData\\ZeroTier\\One\\zerotier-one_x64.exe`
// const winProductName = 'ZeroTier One'
const winServiceName = 'ZeroTierOneService'
const winLnkPath = `C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\ZeroTier.lnk`

// Linux paths - User-space installation
const linuxUserLib = `${app.getPath('home')}/.local/lib/zima-remote/zerotier`
const linuxZTHome = `${app.getPath('home')}/.zima-zerotier`
const linuxZTOPath = `${linuxUserLib}/zerotier-one`
const linuxZTCLIPath = `${linuxUserLib}/zerotier-cli`
const linuxServiceFile = `${app.getPath('home')}/.config/systemd/user/zima-zerotier.service`
const linuxServiceName = 'zima-zerotier.service'

const UnsupportedOSError = new Error('Unsupported OS')

const MONITOR_INTERVAL_LOW = 20000
const MONITOR_INTERVAL_HIGH = 2000

const LOG_COMMAND = false

// PowerShell options
const psOptions: PowerShellOptions = {
  executableOptions: {
    '-ExecutionPolicy': 'Bypass',
    '-NoProfile': true,
  },
}

// --------------------------------------------------
// Shared run has issues in checking running status on Windows when first time implemented
// It seems that the shared instance is not working as expected, so it's disabled for now
// --------------------------------------------------
// If there are preformance issues in the future, consider using shared instance
// --------------------------------------------------
// // Singleton shared instance for high frequency tasks
// let sharedPsInstance: PowerShell | null = null

// // Lazy initialization of shared instance
// function getSharedPowerShellInstance(): PowerShell {
//   if (!sharedPsInstance) {
//     sharedPsInstance = new PowerShell(psOptions)
//   }
//   return sharedPsInstance
// }

// // Run a command with the shared instance
// async function runSharedCommand(command: string): Promise<{ stdout?: string, stderr?: string }> {
//   const ps = getSharedPowerShellInstance()
//   try {
//     const result = await ps.invoke(command)
//     const stdout = result.stdout?.toString().trim()
//     const stderr = result.stderr?.toString().trim()
//     return { stdout, stderr }
//   }
//   catch (error) {
//     console.error(`PowerShell Command Error: ${error}`)
//     throw error
//   }
// }

// Run a command with a new instance
async function runPsCommand(
  command: string,
  timeout: number = 10000,
): Promise<{
    stdout?: string
    stderr?: string
  }> {
  const ps = new PowerShell(psOptions)

  let disposeTimeout: NodeJS.Timeout | null = null
  try {
    disposeTimeout = setTimeoutTask(
      () => {
        log.error('PowerShell Command Timeout:', command)
        ps.dispose()
      },
      timeout,
    )
    const result = await ps.invoke(command)
    clearTimeoutTask(disposeTimeout)
    const stdout = result.stdout?.toString().trim()
    const stderr = result.stderr?.toString().trim()
    return { stdout, stderr }
  }
  catch (error) {
    log.error(`PowerShell Command Error: ${error}`)
    throw error
  }
  finally {
    ps.dispose()
  }
}

export class ZeroTierService {
  private static instance: ZeroTierService

  // Status
  private _installed?: string | false
  private _running?: boolean
  private _authtoken?: string | null

  // Monitoring
  private _monitorTimer?: NodeJS.Timeout // Also used as a monitoring flag
  private _monitorChecking: boolean = false
  private _monitorCheckCount: number = 0
  private _monitorInterval: number = MONITOR_INTERVAL_HIGH

  private constructor() {
    this.startMonitor()
  }

  public static getInstance(): ZeroTierService {
    if (!ZeroTierService.instance) {
      ZeroTierService.instance = new ZeroTierService()
    }
    return ZeroTierService.instance
  }

  get installed() {
    return this._installed
  }

  async checkInstallation(): Promise<string | false> {
    let result: string | false

    if (platform.isMacOS) {
      result = await this.macCheckInstallation()
    }
    else if (platform.isWindows) {
      result = await this.winCheckInstallation()
    }
    else if (platform.isLinux) {
      result = await this.linuxCheckInstallation()
    }
    else {
      throw UnsupportedOSError
    }

    this._installed = result
    return this._installed
  }

  private async macCheckInstallation(): Promise<string | false> {
    return new Promise((resolve) => {
      // Check file exists first
      const fileExists = existsSync(macZTOPath) && existsSync(macPlistPath)
      if (!fileExists) {
        log.info('One of the files not exists:', macZTOPath, macPlistPath)
        resolve(false)
        return
      }

      // Check pkg installed
      const command = `pkgutil --pkg-info ${macPkgId}`
      LOG_COMMAND && log.info('exec:', command)
      exec(
        command,
        (error, stdout, stderr) => {
          if (error || stderr) {
            resolve(false)
          }
          else if (stdout) {
            const versionMatch = stdout.match(/version:\s(\d+\.\d+\.\d+)/)
            resolve(versionMatch?.[1] || false)
          }
          else {
            resolve(false)
          }
        },
      )
    })
  }

  private async winCheckInstallation(): Promise<string | false> {
    return new Promise((resolve) => {
      const fileExists = existsSync(winZTOPath)
      if (!fileExists) {
        log.info('file not exists:', winZTOPath)
        resolve(false)
        return
      }

      // const command
      // = `(Get-ItemProperty -Path "HKLM:\\\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" , "HKLM:\\\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" | Where-Object { $_.DisplayName -eq "${winProductName}" }).DisplayVersion | Select-Object -First 1`
      // LOG_COMMAND && log.info('runPsCommand:', command)
      // runPsCommand(command)
      //   .then((result) => {
      //     const { stdout, stderr } = result
      //     if (stderr) {
      //       resolve(false)
      //     }
      //     else if (stdout) {
      //       resolve(stdout.trim())
      //     }
      //     else {
      //       resolve(false)
      //     }
      //   })
      //   .catch(() => {
      //     resolve(false)
      //   })

      const command = `${winZTOPath} -v`
      LOG_COMMAND && log.info('runPsCommand:', command)
      runPsCommand(command)
        .then((result) => {
          const { stdout, stderr } = result
          if (stderr) {
            resolve(false)
          }
          else if (stdout) {
            resolve(stdout.trim())
          }
          else {
            resolve(false)
          }
        })
        .catch(() => {
          resolve(false)
        })
    })
  }

  private async linuxCheckInstallation(): Promise<string | false> {
    return new Promise((resolve) => {
      // Check if binaries exist in user lib directory
      const fileExists = existsSync(linuxZTOPath) && existsSync(linuxZTCLIPath)
      if (!fileExists) {
        log.info('ZeroTier binaries not found in:', linuxUserLib)
        resolve(false)
        return
      }

      // Check if systemd service file exists
      const serviceExists = existsSync(linuxServiceFile)
      if (!serviceExists) {
        log.info('systemd service file not found:', linuxServiceFile)
        resolve(false)
        return
      }

      // Get version from binary
      const command = `${linuxZTOPath} -v`
      LOG_COMMAND && log.info('exec:', command)
      exec(command, (error, stdout, stderr) => {
        if (error || stderr) {
          log.warn('Failed to get ZeroTier version:', error || stderr)
          resolve(false)
        }
        else if (stdout) {
          // Parse version from output (e.g., "1.14.2")
          const versionMatch = stdout.trim().match(/(\d+\.\d+\.\d+)/)
          resolve(versionMatch?.[1] || false)
        }
        else {
          resolve(false)
        }
      })
    })
  }

  get running() {
    return this._running
  }

  async checkRunning(): Promise<boolean> {
    let result: boolean

    if (platform.isMacOS) {
      result = await this.macCheckRunning()
    }
    else if (platform.isWindows) {
      result = await this.winCheckRunning()
    }
    else if (platform.isLinux) {
      result = await this.linuxCheckRunning()
    }
    else {
      throw UnsupportedOSError
    }

    this._running = result
    return this._running
  }

  private async macCheckRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const command = `pgrep -fl "${macProcessName}"`
      LOG_COMMAND && log.info('exec:', command)
      exec(
        command,
        (error, stdout, stderr) => {
          if (error || stderr) {
            resolve(false)
          }
          else if (stdout) {
            resolve(true)
          }
          else {
            resolve(false)
          }
        },
      )
    })
  }

  private async winCheckRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const command = `(Get-Service -Name "${winServiceName}").Status`
      LOG_COMMAND && log.info('runPsCommand:', command)
      runPsCommand(command)
        .then((result) => {
          const { stdout, stderr } = result
          if (stderr) {
            resolve(false)
          }
          else if (stdout) {
            resolve(stdout.includes('Running'))
          }
          else {
            resolve(false)
          }
        })
        .catch(() => {
          resolve(false)
        })
    })
  }

  private async linuxCheckRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      // First check if system ZeroTier is running (takes precedence)
      const systemCommand = 'systemctl is-active zerotier-one'
      LOG_COMMAND && log.info('exec (checking system):', systemCommand)

      exec(systemCommand, (error, stdout, stderr) => {
        const systemRunning = stdout && stdout.trim() === 'active'

        if (systemRunning) {
          log.info('Using system ZeroTier installation (zerotier-one service)')
          resolve(true)
          return
        }

        // If system ZeroTier not running, check user service
        const userCommand = `systemctl --user is-active ${linuxServiceName}`
        LOG_COMMAND && log.info('exec (checking user):', userCommand)

        exec(userCommand, (userError, userStdout, userStderr) => {
          if (userError) {
            resolve(false)
          }
          else if (userStdout) {
            const isActive = userStdout.trim() === 'active'
            if (isActive) {
              log.info('Using user ZeroTier installation (zima-zerotier service)')
            }
            resolve(isActive)
          }
          else {
            resolve(false)
          }
        })
      })
    })
  }

  get authtoken() {
    return this._authtoken
  }

  async getAuthToken(): Promise<string | null> {
    let result: string | null

    if (platform.isMacOS) {
      result = await this.macGetAuthToken()
    }
    else if (platform.isWindows) {
      result = await this.winGetAuthToken()
    }
    else if (platform.isLinux) {
      result = await this.linuxGetAuthToken()
    }
    else {
      throw UnsupportedOSError
    }

    if (result && result !== this._authtoken) {
      ZeroTier.setAuthtoken(result)
    }

    this._authtoken = result
    return this._authtoken
  }

  private async macGetAuthToken(): Promise<string | null> {
    return new Promise((resolve) => {
      const command = `cat "${macUserFolders[0]}/authtoken.secret" "${macUserFolders[1]}/authtoken.secret" 2>/dev/null`
      LOG_COMMAND && log.info('exec:', command)
      exec(
        command,
        (error, stdout, stderr) => {
          if (error || stderr) {
            resolve(null)
          }
          else if (stdout.trim()) {
            resolve(stdout.trim().substring(0, 24))
          }
        },
      )
    })
  }

  private async winGetAuthToken(): Promise<string | null> {
    return new Promise((resolve) => {
      // const command
      // = `
      //   $token1 = Get-Content "${winUserFolders[0]}\\authtoken.secret" -ErrorAction SilentlyContinue;
      //   $token2 = Get-Content "${winUserFolders[1]}\\authtoken.secret" -ErrorAction SilentlyContinue;
      //   if ($token1) { $token1 } elseif ($token2) { $token2 } else { exit 1 }
      //   `
      // LOG_COMMAND && log.info('runCommand:', command)
      // runPsCommand(command)
      //   .then((result) => {
      //     const { stdout, stderr } = result
      //     if (stderr) {
      //       resolve(null)
      //     }
      //     else if (stdout) {
      //       resolve(stdout)
      //     }
      //   })
      //   .catch(() => {
      //     resolve(null)
      //   })

      try {
        const path1 = `${winUserFolders[0]}\\authtoken.secret`
        const path2 = `${winUserFolders[1]}\\authtoken.secret`

        if (existsSync(path1)) {
          resolve(readFileSync(path1, 'utf8').trim())
          return
        }
        if (existsSync(path2)) {
          resolve(readFileSync(path2, 'utf8').trim())
          return
        }

        resolve(null)
      }
      catch (error) {
        log.error('Failed to read zerotier auth token:', error)
        resolve(null)
      }
    })
  }

  private async linuxGetAuthToken(): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        // First check if system ZeroTier is running
        const systemCommand = 'systemctl is-active zerotier-one'
        exec(systemCommand, (error, stdout, stderr) => {
          const systemRunning = stdout && stdout.trim() === 'active'

          // For system ZeroTier, we use a dummy token
          // The actual zerotier-cli can communicate with the daemon without token
          if (systemRunning) {
            log.info('Using system ZeroTier (no auth token needed for CLI)')
            resolve('system-zerotier') // Dummy token, CLI will work without it
            return
          }

          // Otherwise use user token
          const userTokenPath = `${linuxZTHome}/authtoken.secret`
          if (existsSync(userTokenPath)) {
            const token = readFileSync(userTokenPath, 'utf8').trim()
            log.info('Using user ZeroTier auth token')
            resolve(token)
          }
          else {
            log.info('ZeroTier auth token not found at:', userTokenPath)
            resolve(null)
          }
        })
      }
      catch (error) {
        log.error('Failed to read ZeroTier auth token:', error)
        resolve(null)
      }
    })
  }

  /**
   * Check if ZeroTier binary has required capabilities (Linux only)
   * Returns true if capabilities are set, false otherwise
   */
  async checkCapabilities(): Promise<boolean> {
    if (!platform.isLinux) {
      return true // Not applicable on non-Linux platforms
    }

    return new Promise((resolve) => {
      if (!existsSync(linuxZTOPath)) {
        log.info('ZeroTier binary not found, capabilities cannot be checked')
        resolve(false)
        return
      }

      const command = `getcap ${linuxZTOPath}`
      LOG_COMMAND && log.info('exec:', command)
      exec(command, (error, stdout, stderr) => {
        if (error || stderr) {
          log.info('No capabilities set on ZeroTier binary')
          resolve(false)
        }
        else if (stdout) {
          // Check if output contains the required capabilities
          const hasCapNetAdmin = stdout.includes('cap_net_admin')
          const hasCapNetRaw = stdout.includes('cap_net_raw')
          const hasCorrectCaps = hasCapNetAdmin && hasCapNetRaw

          if (hasCorrectCaps) {
            log.info('ZeroTier binary has correct capabilities')
          }
          else {
            log.warn('ZeroTier binary has incorrect capabilities:', stdout)
          }

          resolve(hasCorrectCaps)
        }
        else {
          resolve(false)
        }
      })
    })
  }

  /**
   * Get the setcap command that needs to be run (Linux only)
   * Returns the command string that user should execute
   */
  getSetcapCommand(): string {
    if (!platform.isLinux) {
      return ''
    }
    return `sudo setcap cap_net_admin,cap_net_raw=eip ${linuxZTOPath}`
  }

  async initAuthToken(): Promise<string> {
    let result: string

    if (platform.isMacOS) {
      result = await this.macInitAuthToken()
    }
    else if (platform.isWindows) {
      result = await this.winInitAuthToken()
    }
    else if (platform.isLinux) {
      throw UnsupportedOSError
    }
    else {
      throw UnsupportedOSError
    }

    this._authtoken = result
    return this._authtoken
  }

  private async macInitAuthToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      const command = [
        `cat "${macFolder}/authtoken.secret"`,
        `install -d -m 700 -o ${UID} -g ${GID} "${macUserFolders[0]}"`,
        `install -m 644 -o ${UID} -g ${GID} "${macFolder}/authtoken.secret" "${macUserFolders[0]}/authtoken.secret"`,
        `install -d -m 700 -o ${UID} -g ${GID} "${macUserFolders[1]}"`,
        `install -m 644 -o ${UID} -g ${GID} "${macFolder}/authtoken.secret" "${macUserFolders[1]}/authtoken.secret"`,
      ].join(' && ')
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, stdout, stderr) => {
          if (error) {
            reject(error)
          }
          if (stderr) {
            reject(stderr)
          }
          if (stdout) {
            resolve(stdout.toString().trim().substring(0, 24))
          }
        },
      )
    })
  }

  private async winInitAuthToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      const command = [
        `type "${winFolder}\\authtoken.secret"`,
        `(if not exist "${winUserFolders[0]}" mkdir "${winUserFolders[0]}")`,
        `copy "${winFolder}\\authtoken.secret" "${winUserFolders[0]}\\authtoken.secret"`,
      ].join(' && ')
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, stdout, stderr) => {
          if (error) {
            reject(error)
          }
          if (stderr) {
            reject(stderr)
          }
          if (stdout) {
            resolve(stdout.toString().trim().substring(0, 24))
          }
        },
      )
    })
  }

  async install(withGUI?: boolean): Promise<void> {
    if (platform.isMacOS) {
      await this.macInstall(withGUI)
    }
    else if (platform.isWindows) {
      await this.winInstall(withGUI)
    }
    else if (platform.isLinux) {
      await this.linuxInstall(withGUI)
    }
    else {
      throw UnsupportedOSError
    }

    await this.checkInstallation()
  }

  private async macInstall(withGUI?: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if GUI installed before
      const hadGUI = existsSync(macAppPath)
      // Install ZeroTier
      const command = [
        `pkill -x ${macProcessName} || true`,
        // Install pkg
        `installer -pkg "${macInstaller}" -target /`,
        // Load daemon
        `launchctl load "${macPlistPath}" 2>/dev/null || true`,
        // Wait for authtoken.secret to be created
        `sleep 2`,
        // Copy authtoken.secret to user folders
        `install -d -m 700 -o ${UID} -g ${GID} "${macUserFolders[0]}"`,
        `install -m 644 -o ${UID} -g ${GID} "${macFolder}/authtoken.secret" "${macUserFolders[0]}/authtoken.secret"`,
        `install -d -m 700 -o ${UID} -g ${GID} "${macUserFolders[1]}"`,
        `install -m 644 -o ${UID} -g ${GID} "${macFolder}/authtoken.secret" "${macUserFolders[1]}/authtoken.secret"`,
        // Remove GUI if not needed
        ...(withGUI
          ? []
          : !hadGUI || withGUI === false
              ? [
                  // Stop GUI if running
                  `pkill -f "${macAppPath}/Contents/MacOS/ZeroTier" || true`,
                  // Del App
                  `rm -rf ${macAppPath}`,
                ]
              : []),
      ].join(' && ')
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, stdout, stderr) => {
          if (error) {
            log.error('error', error)
            reject(error)
          }
          if (stderr) {
            log.error('stderr', stderr)
            reject(stderr)
          }
          if (stdout) {
            log.info('stdout', stdout)
            resolve()
          }
        },
      )
    })
  }

  private async winInstall(withGUI?: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if GUI installed before
      const hadGUI = existsSync(winLnkPath)
      // Install ZeroTier
      const command = [
        // Install msi and wait for it to finish
        `start /wait msiexec /i "${winInstaller}" /quiet /qn /norestart`,
        // Remove GUI if not needed
        ...(
          withGUI
            ? []
            : !hadGUI || withGUI === false
                ? [
                    // Wait for GUI start
                    `timeout /t 1 /nobreak >nul`,
                    // Stop GUI
                    `taskkill /f /im "${winDesktopUIPath.split('\\').pop()}" /nobreak 2>nul || echo 0 >nul`,
                    // Del Lnk
                    `del /f /q "${winLnkPath}" 2>nul || echo 0 >nul`,
                  ]
                : []
        ),
        `echo finished`,
      ].join(' && ')
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, stdout, stderr) => {
          if (error) {
            reject(error)
          }
          if (stderr) {
            reject(stderr)
          }
          if (stdout || stdout === '') {
            resolve()
          }
        },
      )
    })
  }

  private async linuxInstall(_withGUI?: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        log.info('Installing ZeroTier for Linux...')

        // 1. Create directories
        log.info('Creating directories...')
        mkdirSync(linuxUserLib, { recursive: true, mode: 0o755 })
        mkdirSync(linuxZTHome, { recursive: true, mode: 0o700 })
        mkdirSync(`${app.getPath('home')}/.config/systemd/user`, { recursive: true, mode: 0o755 })

        // 2. Copy binaries from bundled resources
        log.info('Copying ZeroTier binaries...')

        // Copy zerotier-one
        if (!existsSync(linuxZTOBin)) {
          reject(new Error(`ZeroTier binary not found: ${linuxZTOBin}`))
          return
        }
        copyFileSync(linuxZTOBin, linuxZTOPath)
        chmodSync(linuxZTOPath, 0o755)

        // Copy zerotier-cli
        if (!existsSync(linuxZTCLIBin)) {
          reject(new Error(`ZeroTier CLI not found: ${linuxZTCLIBin}`))
          return
        }
        copyFileSync(linuxZTCLIBin, linuxZTCLIPath)
        chmodSync(linuxZTCLIPath, 0o755)

        log.info('Binaries copied successfully')

        // 3. Create systemd user service file
        log.info('Creating systemd service...')
        const serviceContent = `[Unit]
Description=ZeroTier for Zima Remote Client (user)
After=network-online.target

[Service]
Type=forking
ExecStart=${linuxZTOPath} -d -U ${linuxZTHome}
ExecStop=${linuxZTCLIPath} -D ${linuxZTHome} shutdown
Restart=always
NoNewPrivileges=false

[Install]
WantedBy=default.target
`
        writeFileSync(linuxServiceFile, serviceContent, { mode: 0o644 })
        log.info('Service file created at:', linuxServiceFile)

        // 4. Reload systemd user daemon
        log.info('Reloading systemd daemon...')
        exec('systemctl --user daemon-reload', (error, stdout, stderr) => {
          if (error) {
            log.error('Failed to reload systemd daemon:', error)
            reject(error)
            return
          }

          // 5. Enable service (but don't start yet - needs capabilities first)
          log.info('Enabling service...')
          exec(`systemctl --user enable ${linuxServiceName}`, (error2, stdout2, stderr2) => {
            if (error2) {
              log.error('Failed to enable service:', error2)
              reject(error2)
              return
            }

            log.info('ZeroTier installation completed successfully')
            log.info('NOTE: Capabilities must be set manually using:')
            log.info(`  sudo setcap cap_net_admin,cap_net_raw=eip ${linuxZTOPath}`)

            resolve()
          })
        })
      }
      catch (error) {
        log.error('Failed to install ZeroTier:', error)
        reject(error)
      }
    })
  }

  async uninstall(): Promise<void> {
    if (platform.isMacOS) {
      await this.macUninstall()
    }
    else if (platform.isWindows) {
      await this.winUninstall()
    }
    else if (platform.isLinux) {
      await this.linuxUninstall()
    }
    else {
      throw UnsupportedOSError
    }

    await this.checkInstallation()
  }

  private async macUninstall(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = [
        `pkill -f "${macAppPath}/Contents/MacOS/ZeroTier" || true`,
        `sh "${macFolder}/uninstall.sh"`,
        `pkgutil --forget ${macPkgId}`,
      ].join(' && ')
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, _stdout, stderr) => {
          if (error) {
            reject(error)
          }
          else if (stderr) {
            reject(stderr)
          }
          else {
            resolve()
          }
        },
      )
    })
  }

  private async winUninstall(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command
        // Only works for build-in MSI installer installed apps
        // `start /wait msiexec /x "${winInstaller}" /quiet /qn /norestart`,
        // Use registry uninstall string instead
        = `powershell -Command "$uninstallPath = (Get-ItemProperty -Path "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" | Where-Object { $_.DisplayName -eq \\"ZeroTier One\\" -and $_.UninstallPath -ne $null }).UninstallPath; if ($uninstallPath) { cmd /c "$uninstallPath /quiet /qn /norestart" } else { throw "Unable to find uninstall path" }"`
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, _stdout, stderr) => {
          if (error) {
            reject(error)
          }
          else if (stderr) {
            reject(stderr)
          }
          else {
            resolve()
          }
        },
      )
    })
  }

  private async linuxUninstall(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        log.info('Uninstalling ZeroTier for Linux...')

        // 1. Stop service if running
        log.info('Stopping service...')
        exec(`systemctl --user stop ${linuxServiceName}`, (stopError) => {
          if (stopError) {
            log.warn('Failed to stop service (may not be running):', stopError)
          }

          // 2. Disable service
          log.info('Disabling service...')
          exec(`systemctl --user disable ${linuxServiceName}`, (disableError) => {
            if (disableError) {
              log.warn('Failed to disable service:', disableError)
            }

            // 3. Remove service file
            log.info('Removing service file...')
            if (existsSync(linuxServiceFile)) {
              try {
                const { unlinkSync } = require('node:fs')
                unlinkSync(linuxServiceFile)
                log.info('Service file removed')
              }
              catch (unlinkError) {
                log.warn('Failed to remove service file:', unlinkError)
              }
            }

            // 4. Remove binaries
            log.info('Removing binaries...')
            try {
              const { unlinkSync, rmdirSync } = require('node:fs')

              if (existsSync(linuxZTOPath)) {
                unlinkSync(linuxZTOPath)
              }
              if (existsSync(linuxZTCLIPath)) {
                unlinkSync(linuxZTCLIPath)
              }

              // Remove directory if empty
              try {
                rmdirSync(linuxUserLib)
              }
              catch {
                // Directory not empty, that's ok
              }

              log.info('Binaries removed')
            }
            catch (removeError) {
              log.warn('Failed to remove binaries:', removeError)
            }

            // NOTE: We keep linuxZTHome (~/.zima-zerotier) to preserve
            // network configurations and auth tokens

            // 5. Reload systemd daemon
            log.info('Reloading systemd daemon...')
            exec('systemctl --user daemon-reload', (reloadError) => {
              if (reloadError) {
                log.warn('Failed to reload systemd daemon:', reloadError)
              }

              log.info('ZeroTier uninstallation completed')
              resolve()
            })
          })
        })
      }
      catch (error) {
        log.error('Failed to uninstall ZeroTier:', error)
        reject(error)
      }
    })
  }

  async start(): Promise<void> {
    if (platform.isMacOS) {
      await this.macStart()
    }
    else if (platform.isWindows) {
      await this.winStart()
    }
    else if (platform.isLinux) {
      await this.linuxStart()
    }
    else {
      throw UnsupportedOSError
    }

    this.checkRunning()
  }

  private async macStart(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = `launchctl load ${macPlistPath} 2>/dev/null || true`
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, _stdout, stderr) => {
          if (error) {
            reject(error)
          }
          else if (stderr) {
            reject(stderr)
          }
          else {
            resolve()
          }
        },
      )
    })
  }

  private async winStart(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = `sc start ${winServiceName}`
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, _stdout, stderr) => {
          if (error) {
            reject(error)
          }
          else if (stderr) {
            reject(stderr)
          }
          else {
            resolve()
          }
        },
      )
    })
  }

  async stop(): Promise<void> {
    if (platform.isMacOS) {
      await this.macStop()
    }
    else if (platform.isWindows) {
      await this.winStop()
    }
    else if (platform.isLinux) {
      await this.linuxStop()
    }
    else {
      throw UnsupportedOSError
    }

    this.checkRunning()
  }

  private async macStop(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = `launchctl unload ${macPlistPath} 2>/dev/null || true`
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, _stdout, stderr) => {
          if (error) {
            reject(error)
          }
          else if (stderr) {
            reject(stderr)
          }
          else {
            resolve()
          }
        },
      )
    })
  }

  private async winStop(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = `sc stop ${winServiceName}`
      LOG_COMMAND && log.info('sudo.exec:', command)
      sudo.exec(
        command,
        { name: app.name, icns },
        (error, _stdout, stderr) => {
          if (error) {
            reject(error)
          }
          else if (stderr) {
            reject(stderr)
          }
          else {
            resolve()
          }
        },
      )
    })
  }

  private async linuxStart(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = `systemctl --user start ${linuxServiceName}`
      LOG_COMMAND && log.info('exec:', command)
      exec(command, (error, _stdout, stderr) => {
        if (error) {
          log.error('Failed to start ZeroTier service:', error)
          reject(error)
        }
        else if (stderr) {
          log.warn('ZeroTier start stderr:', stderr)
          // systemctl may output warnings to stderr but still succeed
          resolve()
        }
        else {
          log.info('ZeroTier service started successfully')
          resolve()
        }
      })
    })
  }

  private async linuxStop(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = `systemctl --user stop ${linuxServiceName}`
      LOG_COMMAND && log.info('exec:', command)
      exec(command, (error, _stdout, stderr) => {
        if (error) {
          log.error('Failed to stop ZeroTier service:', error)
          reject(error)
        }
        else if (stderr) {
          log.warn('ZeroTier stop stderr:', stderr)
          // systemctl may output warnings to stderr but still succeed
          resolve()
        }
        else {
          log.info('ZeroTier service stopped successfully')
          resolve()
        }
      })
    })
  }

  get monitoring() {
    return !!this._monitorTimer
  }

  private async monitorCheck() {
    // Prevent multiple checking
    if (this._monitorChecking) {
      return
    }

    // Start checking
    this._monitorChecking = true
    try {
      // Check status
      await this.checkInstallation()
      await this.checkRunning()
      if (
        this._monitorCheckCount > 0
        && this._monitorCheckCount % 3 !== 0
        && this._monitorInterval === MONITOR_INTERVAL_LOW
      ) {
        // Pass if not the first check and not every 3rd check when running
      }
      else {
        await this.getAuthToken()
      }

      // Adjust monitor interval
      // Low interval when running and has authtoken
      if (this._running && this._authtoken) {
        if (this._monitorInterval !== MONITOR_INTERVAL_LOW) {
          this._monitorInterval = MONITOR_INTERVAL_LOW
          await this.startMonitor()
        }
      }
      // High interval when not running or has no authtoken
      else {
        if (this._monitorInterval !== MONITOR_INTERVAL_HIGH) {
          this._monitorInterval = MONITOR_INTERVAL_HIGH
          await this.startMonitor()
        }
      }
    }
    catch (error) {
      log.error('Monitor Check Error:', error)
    }
    finally {
      this._monitorCheckCount += 1
      if (this._monitorCheckCount >= Number.MAX_SAFE_INTEGER) {
        this._monitorCheckCount = 0
      }
      this._monitorChecking = false
    }
  }

  async startMonitor(): Promise<void> {
    // Stop before start
    await this.stopMonitor()

    // Start Monitoring
    this._monitorTimer = setIntervalTask(this.monitorCheck.bind(this), this._monitorInterval)

    // Initial check
    await this.monitorCheck()
  }

  async stopMonitor(): Promise<void> {
    if (this._monitorTimer) {
      clearIntervalTask(this._monitorTimer)
      this._monitorTimer = undefined
    }
    this._monitorCheckCount = 0
    this._monitorChecking = false
  }

  private ipcHandlers: { [key: string]: () => any }
    = {
      // Status
      'zts:installed': () => this.installed,
      'zts:running': () => this.running,
      'zts:authtoken': () => this.authtoken,
      'zts:monitoring': () => this.monitoring,

      // Actions
      'zts:checkInstallation': () => this.checkInstallation(),
      'zts:checkRunning': () => this.checkRunning(),
      'zts:getAuthToken': () => this.getAuthToken(),
      'zts:checkCapabilities': () => this.checkCapabilities(),
      'zts:getSetcapCommand': () => this.getSetcapCommand(),

      // Sudo actions
      'zts:initAuthToken': () => this.initAuthToken(),
      'zts:install': () => this.install(),
      'zts:uninstall': () => this.uninstall(),
      'zts:start': () => this.start(),
      'zts:stop': () => this.stop(),

      // Monitoring
      'zts:startMonitor': () => this.startMonitor(),
      'zts:stopMonitor': () => this.stopMonitor(),
    }

  registerIpcHandlers() {
    for (const [key, handler] of Object.entries(this.ipcHandlers)) {
      ipcMain.handle(key, handler)
    }
  }

  unregisterIpcHandlers() {
    for (const key of Object.keys(this.ipcHandlers)) {
      ipcMain.removeHandler(key)
    }
  }
}
