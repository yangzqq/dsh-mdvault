/**
 * Diagnostic: is dsh-mdvault actually loaded by DSH as a client module?
 *
 * Connecting to the client-HMR event stream `/plugins/events` immediately
 * yields the live `graph` snapshot — the exact list served to the browser as
 * `window.__DSH_BOOT__`. This script reports whether a package is in it, and
 * independently recomputes the artifact revision of the on-disk bundle to
 * confirm the browser would receive the CURRENT bytes (a stale rev means a
 * page refresh is needed).
 *
 * Read-only: nothing on disk is touched.
 *
 * Usage: node test/probe-graph.mjs [packageName ...]
 *        (defaults to dsh-mdvault and dsh-better-sidebar)
 */
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const names = process.argv.slice(2).length
	? process.argv.slice(2)
	: ['dsh-mdvault', 'dsh-better-sidebar']

/** Mirror of client-modules' artifactRevision (framed sha1, 12 hex chars). */
function artifactRevision(bytes) {
	const hash = createHash('sha1').update('plugin-artifact').update('\0')
	hash.update(String(bytes.byteLength) + ':').update(bytes)
	return hash.digest('hex').slice(0, 12)
}

/** Absolute path of a package's client bundle; this package sits at the cwd. */
function clientBundlePath(name) {
	return name === 'dsh-mdvault'
		? join(here, '..', 'lib', 'client.js')
		: join(here, '..', '..', name, 'lib', 'client.js')
}

function fetchGraph() {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: '127.0.0.1', port: 3080, path: '/plugins/events', method: 'GET', headers: { accept: 'text/event-stream' } },
			(res) => {
				if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return }
				res.setEncoding('utf8')
				let buffer = ''
				const timer = setTimeout(() => { req.destroy(); reject(new Error('no graph event within 5s')) }, 5000)
				res.on('data', (chunk) => {
					buffer += chunk
					// SSE frames are separated by a blank line; keep the tail.
					const frames = buffer.split('\n\n')
					buffer = frames.pop() ?? ''
					for (const frame of frames) {
						for (const line of frame.split('\n')) {
							if (!line.startsWith('data:')) continue
							let parsed
							try { parsed = JSON.parse(line.slice(5).trim()) } catch { continue }
							if (parsed.type === 'graph' && parsed.graph) {
								clearTimeout(timer)
								req.destroy()
								resolve(parsed.graph)
								return
							}
						}
					}
				})
				res.on('end', () => { clearTimeout(timer); reject(new Error('stream ended before a graph event')) })
			},
		)
		req.on('error', (err) => reject(err))
		req.end()
	})
}

let graph
try {
	graph = await fetchGraph()
} catch (err) {
	console.error('could not read the client module graph: ' + err.message)
	console.error('is `dsh web` running on 127.0.0.1:3080?')
	process.exit(1)
}

const entries = new Map(graph.entries.map((e) => [e.id, e]))
console.log('client module graph: ' + entries.size + ' entries, rev ' + graph.rev)
console.log('')

let bad = 0
for (const name of names) {
	const entry = entries.get(name)
	if (!entry) {
		console.log('MISSING     ' + name)
		console.log('            not a client module — check the mount row in the')
		console.log('            profile cordis.patch.yml and restart `dsh web`.')
		bad += 1
		continue
	}
	let onDisk = null
	try {
		onDisk = artifactRevision(readFileSync(clientBundlePath(name)))
	} catch (err) {
		onDisk = 'unreadable: ' + err.message
	}
	// A row still carrying its activation-time revision (`<nonce hex>-<n>`, see
	// client-modules `allocateInitialRevision`) has never been rebuilt, so its
	// rev is a counter rather than a content hash and cannot be compared.
	const isInitialRev = entry.rev.includes('-')
	const fresh = isInitialRev || onDisk === entry.rev
	const note = isInitialRev
		? '(activation-time rev — no rebuild observed since startup)'
		: fresh ? '(matches — browser has current code)' : '(STALE — reload the page)'
	console.log('LOADED      ' + name)
	console.log('            url   ' + entry.url)
	console.log('            rev   ' + entry.rev)
	console.log('            disk  ' + onDisk + '  ' + note)
	if (entry.inject && entry.inject.length) console.log('            inject ' + entry.inject.join(', '))
	if (!fresh) bad += 1
}

process.exit(bad === 0 ? 0 : 1)
