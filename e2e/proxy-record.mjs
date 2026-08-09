/**
 * Recording proxy: sits on port 80, forwards to a real ZimaOS device, writes down every
 * exchange.
 *
 * Why record instead of hand-writing a fake: a hand-written fake is a guess about what the
 * client asks for and what the device answers, and this project has a written rule against
 * exactly that. Recording produces fixtures that are *measurements* — the request the client
 * really made, the body the device really returned, in the order they really happened.
 *
 * It listens on 80 because the client has no port field: the UI always connects on 80. Under
 * Docker that port is published without any privilege of ours:
 *
 *   docker run --rm -p 127.0.0.1:80:80 -e ZIMA_UPSTREAM=http://<device-address> \
 *     -v "$PWD/e2e:/app" -v "<outdir>:/out" node:22-alpine node /app/proxy-record.mjs
 *
 * 🔴 What comes out is NOT fit to commit as-is. It contains a real device's folder names,
 * account name and tokens. `scrub-fixture.mjs` is the second half of this pipeline and the
 * only thing whose output belongs in the repository.
 */
import { createServer, request as httpRequest } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { URL } from 'node:url'

const upstream = new URL(process.env['ZIMA_UPSTREAM'] ?? '')
const outPath = process.env['ZIMA_RECORD_TO'] ?? '/out/recording.json'
if (upstream.hostname.length === 0) {
  console.error('ZIMA_UPSTREAM must name the device, e.g. http://<device-address>')
  process.exit(2)
}

/** Every exchange, in order. Order matters: it is also the record of what the client does. */
const exchanges = []
let pending = 0

const readBody = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })

const server = createServer(async (clientReq, clientRes) => {
  const requestBody = await readBody(clientReq)
  pending += 1

  /*
   * 🔴 `accept-encoding` is stripped on the way out, so the device answers in plain text.
   *
   * Without this the first recording captured gzip bytes decoded as UTF-8 — irreversibly
   * mangled — and every fixture read "kein JSON". Which looked like a finding about the
   * device and was a finding about this file. Recording a compressed stream would also mean
   * the fixtures could never be reviewed by eye, and an unreadable fixture is a fixture
   * nobody checks for someone's private data.
   */
  const forwardedHeaders = { ...clientReq.headers, host: upstream.host }
  delete forwardedHeaders['accept-encoding']

  const proxyReq = httpRequest(
    {
      host: upstream.hostname,
      port: upstream.port.length > 0 ? Number(upstream.port) : 80,
      method: clientReq.method,
      path: clientReq.url,
      headers: forwardedHeaders,
    },
    async (proxyRes) => {
      const responseBody = await readBody(proxyRes)

      exchanges.push({
        method: clientReq.method ?? 'GET',
        path: clientReq.url ?? '/',
        status: proxyRes.statusCode ?? 0,
        contentType: proxyRes.headers['content-type'] ?? '',
        // Binary answers (thumbnails, downloads) are kept only by their size and type.
        // A repository is no place for someone's photographs, and the client only needs
        // *an* image of the right kind to render a grid.
        body: String(proxyRes.headers['content-type'] ?? '').startsWith('image/')
          ? { kind: 'binary', bytes: responseBody.length }
          : // Round-trip checked, not assumed: anything that does not survive
            // Buffer -> utf8 -> Buffer is kept as base64 rather than silently corrupted.
            responseBody.equals(Buffer.from(responseBody.toString('utf8'), 'utf8'))
            ? { kind: 'text', text: responseBody.toString('utf8') }
            : { kind: 'base64', base64: responseBody.toString('base64') },
        requestBody: requestBody.length === 0 ? null : requestBody.toString('utf8'),
      })

      clientRes.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      clientRes.end(responseBody)
      pending -= 1
    },
  )

  proxyReq.on('error', (cause) => {
    // Loud, never a silent empty answer: a proxy that swallows an upstream failure teaches
    // the recording that the device returned nothing, which is a lie the fixtures inherit.
    console.error(`upstream failed for ${clientReq.method} ${clientReq.url}: ${cause.message}`)
    exchanges.push({
      method: clientReq.method ?? 'GET',
      path: clientReq.url ?? '/',
      status: 0,
      error: cause.message,
    })
    clientRes.writeHead(502, { 'content-type': 'text/plain' })
    clientRes.end(`recording proxy: upstream failed: ${cause.message}`)
    pending -= 1
  })

  proxyReq.end(requestBody)
})

const flush = async () => {
  await writeFile(outPath, JSON.stringify({ upstream: upstream.host, exchanges }, null, 2))
  console.log(`recorded ${exchanges.length} exchanges -> ${outPath}`)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await flush()
    process.exit(0)
  })
}

// Also flush periodically: a container killed with SIGKILL never runs the handler above, and
// a recording that only exists in memory is a recording that does not exist.
setInterval(() => {
  if (pending === 0 && exchanges.length > 0) void flush()
}, 5_000)

server.listen(80, '0.0.0.0', () => {
  console.log(`recording proxy on :80 -> ${upstream.host}`)
})
