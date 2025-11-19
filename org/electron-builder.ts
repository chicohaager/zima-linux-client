/* eslint-disable no-console */
/* eslint-disable no-template-curly-in-string */
import type { Configuration } from 'electron-builder'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import { dirname, join, relative } from 'node:path'
import { env } from 'node:process'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import dotenv from 'dotenv'
import _ from 'lodash'
import semver from 'semver'
import yaml from 'yaml'

const onlineUpdateBaseURL = 'https://zima-client.r2.icewhale.io/v2'

// Load environment variables
console.log(`\nLoaded environment variables from:`)
const envFiles = [
  '.env.local',
  `.env.${os.platform()}.local`,
  '.env.build.local',
]
for (const file of envFiles) {
  dotenv.config({ path: file })
  console.log(`- ${file}`)
}
console.log()

function getChannelsByVersion(version: string): string[] {
  const prerelease = semver.prerelease(version)
  if (prerelease === null) {
    return ['latest', 'rc', 'beta', 'alpha']
  }
  switch (prerelease[0]) {
    case 'rc':
      return ['rc', 'beta', 'alpha']
    case 'beta':
      return ['beta', 'alpha']
    case 'alpha':
      return ['alpha']
  }
  return []
}

function getChannelFileSuffix(targetArch?: string): string {
  if (os.platform() === 'linux') {
    const arch = targetArch ?? (env.TEST_UPDATER_ARCH || os.arch())
    const archSuffix = arch === 'x64' ? '' : `-${arch}`
    return `-linux${archSuffix}`
  }
  else {
    return os.platform() === 'darwin' ? '-mac' : ''
  }
}

function getAllFilesWithRelativePaths(baseDir: string, currentDir: string = baseDir) {
  let files: string[] = []

  // 读取目录内容
  const items = readdirSync(currentDir)

  for (const item of items) {
    const fullPath = join(currentDir, item)
    const relativePath = relative(baseDir, fullPath) // 计算相对路径

    if (statSync(fullPath).isDirectory()) {
      // 递归读取子目录
      files = files.concat(getAllFilesWithRelativePaths(baseDir, fullPath))
    }
    else {
      // 保存文件的相对路径和绝对路径
      files.push(relativePath)
    }
  }

  return files
}

let firstTimeArtifactBuildCompleted = true

const config: Configuration = {
  appId: 'com.zimaspace.zima',
  productName: 'Zima',
  directories: {
    buildResources: 'build',
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}',
    ...(os.platform() === 'win32' || os.platform() === 'linux'
      ? [
          '!**/*.icns',
          '!resources/installer/**/*.pkg',
        ]
      : os.platform() === 'darwin' || os.platform() === 'linux'
        ? [
            '!**/*.ico',
            '!resources/installer/**/*.msi',
          ]
        : []),
  ],
  asarUnpack: [
    'resources/**',
  ],
  // generateUpdatesFilesForAllChannels: true,
  // detectUpdateChannel: true,
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  mac: {
    icon: 'resources/icons/zima.icns',
    entitlements: 'build/entitlements.mac.plist',
    extendInfo: {
      NSDocumentsFolderUsageDescription: 'Application requests access to the user\'s Documents folder.',
      NSDownloadsFolderUsageDescription: 'Application requests access to the user\'s Downloads folder.',
    },
  },
  dmg: {
    icon: 'build/zimaPkg.icns',
  },
  win: {
    icon: 'resources/icons/zima.ico',
    signtoolOptions: {
      certificateSubjectName: 'ICEWHALE TECHNOLOGY LIMITED',
      rfc3161TimeStampServer: 'http://timestamp.sectigo.com',
      signingHashAlgorithms: ['sha256'],
    },
  },
  nsis: {
    shortcutName: '${productName}',
    installerIcon: 'build/zimaPkg.ico',
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
  },
  // publish: null,
  publish: [
    {
      provider: 'generic',
      url: 'https://zima-client.r2.icewhale.io/v2/${os}/${arch}',
      updaterCacheDirName: 'zima-client-v2-updater',
    },
  //   {
  //     provider: 's3',
  //     bucket: 'zima-client',
  //     path: '/v2',
  //     endpoint: 'https://09a207f03f6818f4ab62111b20a34941.r2.cloudflarestorage.com',
  //   },
  ],
  npmRebuild: false,
  // Build Hooks
  artifactBuildCompleted: async (context) => {
    const name = context.file.split(/[/\\]/).pop()
    const outDir = context.target?.outDir

    // Filter out blockmap files
    if (outDir && name && !name.endsWith('.blockmap')) {
      // console.log('Artifact', context.file)

      // Get update directory
      const updateDir = join(outDir, 'update')

      // Remove old update files on first time artifact build completed
      if (firstTimeArtifactBuildCompleted) {
        firstTimeArtifactBuildCompleted = false
        if (existsSync(updateDir)) {
          rmSync(updateDir, { recursive: true, force: true })
        }
      }

      // Get channels by version
      const version = context.packager.appInfo.version
      const channels = getChannelsByVersion(version)

      // Get os and arch
      const os = name.split(version)[1].split('.')[0].split('-')[1]
      const arch = name.split(version)[1].split('.')[0].split('-')[2]

      // Get file sha512 and size
      const sha512 = context.updateInfo.sha512
      const size = context.updateInfo.size

      // Generate file info
      if (channels.length && os && arch && sha512 && size) {
        const file = {
          url: name,
          sha512,
          size,
        }

        // Add file info to each channel json and yml
        for (const channel of channels) {
          const jsonPath = join(updateDir, os, arch, `${channel}${getChannelFileSuffix(arch)}.json`)
          const ymlPath = join(updateDir, os, arch, `${channel}${getChannelFileSuffix(arch)}.yml`)

          // Generate JSON and YAML
          let json
          if (existsSync(jsonPath)) {
            // Read existing JSON
            json = JSON.parse(readFileSync(jsonPath, 'utf8'))
            json.files = json.files.filter((f: any) => f.url !== file.url)
            json.files.push(file)
            json.files = _.uniqWith(json.files, _.isEqual)
          }
          else {
            // Make directory if not exists
            // console.log('Make directory:', dirname(jsonPath))
            mkdirSync(dirname(jsonPath), { recursive: true })
            // Create new JSON
            json = {
              version,
              files: [file],
            }
          }

          // Update release info
          json.releaseDate = new Date().toISOString()
          if (env.STAGING_PERCENTAGE) {
            json.stagingPercentage = Number.parseInt(env.STAGING_PERCENTAGE)
          }
          else {
            delete json.stagingPercentage
          }

          // Write JSON and YAML
          // console.log('Writing JSON:', jsonPath)
          writeFileSync(jsonPath, JSON.stringify(json, null, 2))
          // console.log('Writing YAML:', ymlPath)
          writeFileSync(ymlPath, yaml.stringify(json))
        }
      }
    }
  },
  afterAllArtifactBuild: async (result) => {
    // Upload artifacts
    if (!(env.UPLOAD_ARTIFACTS === 'true')) {
      console.log('Environment variable UPLOAD_ARTIFACTS is not set to true, skipping uploading artifacts.')
      return []
    }

    // Get update directory files
    const updateDir = join(result.outDir, 'update')
    const updateFiles = getAllFilesWithRelativePaths(updateDir)
    console.log('updateFiles', updateFiles)

    // Get version
    const version = JSON.parse(
      readFileSync(
        join(
          updateDir,
          updateFiles.filter(f => f.endsWith('.json'))[0],
        ),
        'utf8',
      ),
    ).version

    // Get Online update files directory
    const onlineUpdateDir = join(result.outDir, 'online-update')
    // Delele existing online update directory
    if (existsSync(onlineUpdateDir)) {
      rmSync(onlineUpdateDir, { recursive: true, force: true })
    }

    // Download online update files if version is same
    const onlineUpdateFiles: string[] = []
    for (const file of updateFiles.filter(f => f.endsWith('.json'))) {
      const url = `${onlineUpdateBaseURL}/${file.replace(/\\/g, '/')}`
      const filePath = join(onlineUpdateDir, file)
      const dirPath = dirname(filePath)
      console.log('Downloading:', url)
      const response = await fetch(url)
      if (response.ok) {
        const json = await response.json()
        if (json.version === version) {
          if (!existsSync(dirPath)) {
            mkdirSync(dirPath, { recursive: true })
          }
          console.log('Saving:', filePath.replace(result.outDir, ''))
          writeFileSync(filePath, JSON.stringify(json, null, 2))
          onlineUpdateFiles.push(file)
        }
      }
    }
    console.log('onlineUpdateFiles', onlineUpdateFiles)

    // Merge online update files into update files
    for (const file of onlineUpdateFiles) {
      console.log('Merging:', file)
      const onlineUpdateJson = JSON.parse(readFileSync(join(onlineUpdateDir, file), 'utf8'))
      const updateJson = JSON.parse(readFileSync(join(updateDir, file), 'utf8'))
      updateJson.files = updateJson.files.concat(
        onlineUpdateJson.files.filter(
          // Filter out existing files by url
          (f: any) => !updateJson.files.some((uf: any) => uf.url === f.url),
        ),
      )
      updateJson.files = _.uniqWith(updateJson.files, _.isEqual)
      writeFileSync(join(updateDir, file), JSON.stringify(updateJson, null, 2))
      writeFileSync(join(updateDir, file.replace('.json', '.yml')), yaml.stringify(updateJson))
    }

    // Get all upload tasks
    const uploadTasks: [string, string][] = []
    // Add artifacts
    for (const artifact of result.artifactPaths) {
      const os = artifact.split(version)[1].split('.')[0].split('-')[1]
      const arch = artifact.split(version)[1].split('.')[0].split('-')[2]
      uploadTasks.push([
        artifact,
        `v2/${os}/${arch}/${artifact.split(/[/\\]/).pop()!}`,
      ])
    }
    // Add update files
    for (const file of updateFiles) {
      uploadTasks.push([
        join(updateDir, file),
        `v2/${file.replace(/\\/g, '/')}`,
      ])
    }
    console.log('uploadTasks', uploadTasks)

    // Upload to Cloudflare R2 through S3 API
    const s3 = new S3Client({
      region: 'us-east-1', // Useless default value
      endpoint: 'https://09a207f03f6818f4ab62111b20a34941.r2.cloudflarestorage.com',
    })
    async function uploadFileToR2(key, filePath, retry = 0) {
      console.log('Uploading:', filePath)
      try {
        const body = readFileSync(filePath)
        const command = new PutObjectCommand({
          Bucket: 'zima-client',
          Key: key,
          Body: body,
        })
        await s3.send(command, { requestTimeout: 2 * 60 * 1000 })
        console.log('- Successfull uploaded:', key)
      }
      catch (err) {
        if (retry < 3) {
          console.error(`- Retry uploading file (${retry + 1}/3):`, err)
          await uploadFileToR2(key, filePath, retry + 1)
        }
        else {
          throw err
        }
      }
    }
    for (const [filePath, key] of uploadTasks) {
      await uploadFileToR2(key, filePath)
    }

    return []
  },
}

export default config
