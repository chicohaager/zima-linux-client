import { createSocket } from 'node:dgram'
import type { DiscoveredDevice } from '@shared/domain'
import { MDNS_PORT, MDNS_SERVICE_TYPE } from '@main/zima/endpoints'

/**
 * LAN discovery over mDNS/DNS-SD.
 *
 * ZimaOS advertises `_zimaos._tcp` on port 80 with the TXT record `os=ZimaOS`.
 * That was read from /etc/avahi/services/zimaos.service on the device AND
 * cross-checked from the network side with a raw PTR query (two answers, instances
 * "ZimaOS" and "ZimaOS-2", SRV port 0x0050). The config file alone would not have
 * proven the service is actually announced.
 *
 * Implemented against the wire format directly rather than pulling in a bonjour
 * package: we need exactly one query type, and a native dependency would be one more
 * portability risk across distros.
 */

const MDNS_GROUP = '224.0.0.251'
const MDNS_UDP_PORT = 5353

const TYPE_A = 1
const TYPE_TXT = 16
const TYPE_SRV = 33

const encodeName = (name: string): Buffer => {
  const parts = name
    .split('.')
    .filter((label) => label.length > 0)
    .map((label) => {
      const bytes = Buffer.from(label, 'utf8')
      return Buffer.concat([Buffer.from([bytes.length]), bytes])
    })
  return Buffer.concat([...parts, Buffer.from([0])])
}

const ptrQuery = (serviceType: string): Buffer => {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(1, 4) // QDCOUNT
  return Buffer.concat([
    header,
    encodeName(`${serviceType}.local`),
    Buffer.from([0x00, 0x0c, 0x00, 0x01]), // QTYPE=PTR, QCLASS=IN
  ])
}

/** Reads a name, following compression pointers; `next` is past the encoded form. */
const readName = (buf: Buffer, offset: number): { name: string; next: number } => {
  const labels: string[] = []
  let cursor = offset
  let next: number | null = null
  let guard = 0

  while (cursor < buf.length && guard++ < 128) {
    const length = buf[cursor]
    if (length === undefined) break
    if (length === 0) {
      cursor += 1
      break
    }
    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | (buf[cursor + 1] ?? 0)
      if (next === null) next = cursor + 2
      cursor = pointer
      continue
    }
    labels.push(buf.subarray(cursor + 1, cursor + 1 + length).toString('utf8'))
    cursor += length + 1
  }

  return { name: labels.join('.'), next: next ?? cursor }
}

const parseTxt = (buf: Buffer): Record<string, string> => {
  const out: Record<string, string> = {}
  let cursor = 0
  while (cursor < buf.length) {
    const length = buf[cursor]
    if (length === undefined || length === 0) break
    const entry = buf.subarray(cursor + 1, cursor + 1 + length).toString('utf8')
    const eq = entry.indexOf('=')
    if (eq > 0) out[entry.slice(0, eq)] = entry.slice(eq + 1)
    cursor += length + 1
  }
  return out
}

interface Answer {
  readonly name: string
  readonly type: number
  /** Absolute offset of the record data inside the message. */
  readonly dataOffset: number
  readonly dataLength: number
}

/** Walks answer, authority and additional sections, keeping absolute offsets. */
export const parseAnswers = (buf: Buffer): readonly Answer[] => {
  if (buf.length < 12) return []
  const questions = buf.readUInt16BE(4)
  const records = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10)

  let cursor = 12
  for (let i = 0; i < questions && cursor < buf.length; i++) {
    cursor = readName(buf, cursor).next + 4
  }

  const answers: Answer[] = []
  for (let i = 0; i < records && cursor + 10 <= buf.length; i++) {
    const { name, next } = readName(buf, cursor)
    const type = buf.readUInt16BE(next)
    const dataLength = buf.readUInt16BE(next + 8)
    const dataOffset = next + 10
    answers.push({ name, type, dataOffset, dataLength })
    cursor = dataOffset + dataLength
  }
  return answers
}

/** Correlates SRV/TXT/A records into devices. Exported so it can be unit-tested. */
export const collectDevices = (messages: readonly Buffer[]): readonly DiscoveredDevice[] => {
  const srv = new Map<string, { port: number; target: string }>()
  const txt = new Map<string, Record<string, string>>()
  const ipByHost = new Map<string, string>()

  for (const msg of messages) {
    for (const answer of parseAnswers(msg)) {
      if (answer.type === TYPE_SRV && answer.name.includes(MDNS_SERVICE_TYPE)) {
        srv.set(answer.name, {
          port: msg.readUInt16BE(answer.dataOffset + 4),
          target: readName(msg, answer.dataOffset + 6).name,
        })
      } else if (answer.type === TYPE_TXT && answer.name.includes(MDNS_SERVICE_TYPE)) {
        txt.set(answer.name, parseTxt(msg.subarray(answer.dataOffset, answer.dataOffset + answer.dataLength)))
      } else if (answer.type === TYPE_A && answer.dataLength === 4) {
        ipByHost.set(
          answer.name,
          [...msg.subarray(answer.dataOffset, answer.dataOffset + 4)].join('.'),
        )
      }
    }
  }

  const devices: DiscoveredDevice[] = []
  for (const [instance, record] of srv) {
    const host = ipByHost.get(record.target)
    if (host === undefined) continue
    devices.push({
      host,
      name: instance.split(`.${MDNS_SERVICE_TYPE}`)[0] ?? instance,
      port: record.port,
      txt: txt.get(instance) ?? {},
    })
  }
  return devices
}

/**
 * Sends one PTR query and collects answers for `timeoutMs`.
 *
 * An empty result means "nothing answered in this window" — NOT "there is no ZimaOS
 * here". mDNS is routinely blocked across VLANs, so callers must present it that way
 * and offer the subnet probe instead of claiming the device does not exist.
 */
export const discover = async (timeoutMs = 3_000): Promise<readonly DiscoveredDevice[]> => {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  const messages: Buffer[] = []

  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      resolve(collectDevices(messages))
    }

    const timer = setTimeout(finish, timeoutMs)
    socket.on('error', finish)
    socket.on('message', (msg) => messages.push(Buffer.from(msg)))
    socket.bind(() => {
      socket.setMulticastTTL(255)
      socket.send(ptrQuery(MDNS_SERVICE_TYPE), MDNS_UDP_PORT, MDNS_GROUP, (error) => {
        if (error) finish()
      })
    })
  })
}

export const defaultPort = MDNS_PORT
