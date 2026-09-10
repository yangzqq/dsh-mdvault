/**
 * End-to-end delivery check: does the browser actually receive the code that is
 * on disk, and does that code contain the features we expect?
 *
 * This closes the gap that `probe:graph` leaves. The graph tells you a row
 * exists and its rev matches the on-disk artifact, but not whether the bytes
 * the server hands the browser really are the current ones — which is exactly
 * the situation where "my fix did nothing" turns out to be a stale bundle.
 *
 * Read-only: nothing is touched.
 *
 * Usage: node test/verify-served.mjs
 */
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(here, '..', 'lib', 'client.js')

function get(path) {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: '127.0.0.1', port: 3080, path, method: 'GET' }, (res) => {
			let s = ''
			res.setEncoding('utf8')
			res.on('data', (c) => { s += c })
			res.on('end', () => resolve({ status: res.statusCode, body: s }))
		})
		req.on('error', reject)
		req.end()
	})
}

/** The live graph snapshot from the client-HMR SSE stream. */
function fetchGraph() {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: '127.0.0.1', port: 3080, path: '/plugins/events', method: 'GET', headers: { accept: 'text/event-stream' } },
			(res) => {
				res.setEncoding('utf8')
				let buffer = ''
				const timer = setTimeout(() => { req.destroy(); reject(new Error('no graph event within 5s')) }, 5000)
				res.on('data', (chunk) => {
					buffer += chunk
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
			},
		)
		req.on('error', reject)
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

const entry = graph.entries.find((e) => e.id === 'dsh-mdvault')
if (!entry) {
	console.error('MISSING dsh-mdvault in the client module graph')
	process.exit(1)
}

const served = await get(entry.url)
if (served.status !== 200) {
	console.error('served ' + entry.url + ' -> HTTP ' + served.status + ' (page refresh needed?)')
	process.exit(1)
}

const onDisk = readFileSync(BUNDLE, 'utf8')
console.log('graph rev = ' + entry.rev)
console.log('served    = ' + served.body.length + ' bytes')
console.log('on disk   = ' + onDisk.length + ' bytes')
console.log('')

// Read the expected build id from the source itself, so bumping the version
// can never leave this probe asserting a stale string.
const versionMatch = /const MDVAULT_VERSION = '([^']+)'/.exec(onDisk)
if (versionMatch === null) {
	console.error('could not find MDVAULT_VERSION in lib/client.js')
	process.exit(1)
}
const version = versionMatch[1]
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const probes = [
	['build id matches the source', "'" + version + "'"],
	['declared inject', 'exports.inject'],
	['document-level interceptor', 'onDocumentClick'],
	['capture-phase registration', "addEventListener('click', onDocumentClick, true)"],
	['URL-based link classification', 'classifyInternalLink'],
	['nav root registry', 'navByRoot'],
	['nav root marker', "'data-mdv-root'"],
	['default-collapsed tree', 'isDirOpen'],
	['collapse-all control', '折叠'],
	['composer hiding', 'data-mdvault-hide-composer'],
	['mermaid SVG sanitizer', 'sanitizeSvg'],
	['code size tiers', 'HIGHLIGHT_MAX'],
]
let bad = 0
for (const [label, needle] of probes) {
	const ok = served.body.includes(needle)
	if (!ok) bad += 1
	console.log((ok ? '  ok   ' : '  MISS ') + label)
}

// The toolbar shows the in-source build id, so package.json must agree or the
// two would silently disagree.
const versionAgrees = pkg.version === version
console.log((versionAgrees ? '  ok   ' : '  MISS ') + 'package.json version === build id (' + version + ')')
if (!versionAgrees) {
	bad += 1
	console.log('        package.json says ' + pkg.version)
}

// The combo route serves the module source verbatim, followed only by a
// `;\n//# sourceMappingURL=...` trailer, so byte-identity is the wrong test —
// but the served body must still CONTAIN the exact on-disk source.
const identical = served.body === onDisk
const contains = served.body.indexOf(onDisk) >= 0
const trailer = contains ? served.body.slice(onDisk.length) : ''
const onlySourceMapTrailer = /^;\s*\n\/\/# sourceMappingURL=\S*\s*$/.test(trailer)
console.log((contains && onlySourceMapTrailer ? '  ok   ' : '  MISS ')
	+ 'served body is the on-disk source plus only a sourcemap trailer')
if (!(contains && onlySourceMapTrailer)) {
	bad += 1
	if (identical) console.log('        (served body was byte-identical)')
	else console.log('        trailer: ' + JSON.stringify(trailer.slice(0, 200)))
}

console.log('')
if (bad === 0) {
	console.log('OK — the browser will receive the current build (v' + version + ').')
	console.log('If the tab still shows old behavior, the page itself is stale: hard-refresh it.')
} else {
	console.log(bad + ' check(s) failed.')
}
process.exit(bad === 0 ? 0 : 1)
