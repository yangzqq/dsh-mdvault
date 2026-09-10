/**
 * Diagnostic: prove whether dsh-mdvault is a client-module graph row.
 *
 * dsh-client-hmr stat-polls every graph row's client.js every 500 ms and emits
 * `{"type":"rebuilt","id":<package>,"rev":<rev>}` on /plugins/events when the
 * file changes. If touching lib/client.js produces a rebuilt event for
 * dsh-mdvault, the plugin's browser half IS registered and will hot-reload.
 *
 * Usage: node test/probe-hmr.mjs [packageName ...]
 */
import http from 'node:http'
import { statSync, utimesSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const targets = process.argv.slice(2)
const names = targets.length ? targets : ['dsh-mdvault', 'dsh-better-sidebar']

const events = []
const req = http.request(
	{ host: '127.0.0.1', port: 3080, path: '/plugins/events', method: 'GET', headers: { accept: 'text/event-stream' } },
	(res) => {
		console.log('SSE connected: ' + res.statusCode)
		res.setEncoding('utf8')
		res.on('data', (chunk) => {
			for (const line of chunk.split('\n')) {
				if (line.startsWith('data:')) events.push(line.slice(5).trim())
			}
		})
	},
)
req.on('error', (err) => { console.error('SSE error: ' + err.message); process.exit(1) })
req.end()

// Bump mtime only (content unchanged) so the watcher's {mtimeMs,size} diff
// fires for every target without altering any file.
function touch(rel) {
	const abs = join(here, '..', rel)
	try {
		const now = new Date()
		utimesSync(abs, now, now)
		return statSync(abs).mtimeMs
	} catch (err) {
		console.log('  cannot touch ' + abs + ': ' + err.message)
		return null
	}
}

await new Promise((r) => setTimeout(r, 800))
console.log('touching ' + names.length + ' client bundle(s)...')
for (const name of names) touch(join('node_modules', name, 'lib', 'client.js').replace(/\\/g, '/').replace('node_modules/', ''))
// mdvault lives in the cwd itself; better-sidebar is a sibling.
touch('lib/client.js')
for (const name of names) {
	if (name !== 'dsh-mdvault') touch('../' + name + '/lib/client.js')
}

await new Promise((r) => setTimeout(r, 3500))
req.destroy()

console.log('')
console.log('rebuilt events observed: ' + events.length)
const seen = new Set()
for (const raw of events) {
	let parsed
	try { parsed = JSON.parse(raw) } catch { continue }
	if (parsed.type !== 'rebuilt') continue
	seen.add(parsed.id)
	console.log('  rebuilt id=' + parsed.id + '  rev=' + parsed.rev)
}
console.log('')
for (const name of names) {
	console.log((seen.has(name) ? 'WATCHED   ' : 'NOT WATCHED') + '  ' + name)
}
