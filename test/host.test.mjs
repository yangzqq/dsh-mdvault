/**
 * Host-half integration tests for dsh-mdvault.
 *
 * `lib/index.js` exports `apply(ctx)`; this harness supplies a fake Cordis
 * context, captures every route it registers on `ctx.webServer`, and drives
 * the handlers with fake req/res objects. So the real shipped route logic —
 * path fencing, content types, the JSON API, and the vendored-library routes
 * with their ETag/304 handling — is exercised without a running server.
 *
 * The fake `ctx.fs` is backed by the real filesystem under this package, so
 * reads and writes are genuine.
 *
 * Run: node test/host.test.mjs
 */
import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, stat, mkdtemp, rm, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = resolve(here, '..')

let passed = 0
const failures = []
async function test(name, fn) {
	try {
		await fn()
		passed += 1
		console.log('  ok  ' + name)
	} catch (err) {
		failures.push(name)
		console.error('FAIL  ' + name)
		console.error('      ' + (err && err.message))
		process.exitCode = 1
	}
}

// ── fake Cordis context over the real filesystem ────────────────────────────

const ROOT = await mkdtemp(join(tmpdir(), 'mdvault-test-'))

function makeFakeFs(root) {
	const target = (p) => ({ targetKey: 'k:' + p, displayPath: p })
	return {
		async resolve(p, opts) {
			const base = opts && opts.cwd ? opts.cwd : root
			return target(resolve(base, String(p == null ? '' : p)))
		},
		async stat(t) {
			try {
				const s = await stat(t.displayPath)
				return { type: s.isDirectory() ? 'directory' : 'file', size: s.size }
			} catch {
				return undefined
			}
		},
		async readText(t) { return readFile(t.displayPath, 'utf8') },
		async readBytes(t) { return readFile(t.displayPath) },
		async writeText(t, content) {
			await mkdir(dirname(t.displayPath), { recursive: true })
			await writeFile(t.displayPath, content, 'utf8')
			return { operation: 'update' }
		},
		async listDir(t) {
			const entries = await readdir(t.displayPath, { withFileTypes: true })
			return entries.map((e) => ({
				name: e.name,
				type: e.isDirectory() ? 'directory' : 'file',
				target: target(join(t.displayPath, e.name)),
			}))
		},
	}
}

const routes = []
const ctx = {
	fs: makeFakeFs(ROOT),
	effect(fn) { return fn() },
	get(name) {
		if (name === 'sandboxPolicy') return { workspaceRoot: ROOT }
		return undefined
	},
	webServer: {
		register(route) {
			routes.push(route)
			return () => {}
		},
	},
}

const mod = await import(pathToFileURL(join(PLUGIN_DIR, 'lib', 'index.js')).href)
assert.equal(mod.name, 'dsh-mdvault')
mod.apply(ctx)

/** Find a registered route by its path. */
function routeFor(path) {
	const found = routes.find((r) => r.path === path)
	assert.ok(found, 'no route registered for ' + path)
	return found
}

function makeReq({ method = 'GET', url = '/', body = null, headers = {} } = {}) {
	const chunks = body === null ? [] : [Buffer.from(body, 'utf8')]
	return {
		method,
		url,
		headers,
		async *[Symbol.asyncIterator]() { for (const c of chunks) yield c },
	}
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		writeHead(status, headers) {
			this.statusCode = status
			if (headers) for (const k of Object.keys(headers)) this.headers[k.toLowerCase()] = headers[k]
			return this
		},
		end(body) {
			this.body = body === undefined ? null : body
			this.ended = true
			return this
		},
	}
}

async function call(route, reqOpts) {
	const res = makeRes()
	await route.handler(makeReq(reqOpts), res)
	return res
}

function json(res) {
	return JSON.parse(res.body.toString('utf8'))
}

// ── fixtures ────────────────────────────────────────────────────────────────

await writeFile(join(ROOT, 'README.md'), '# hi\n', 'utf8')
await writeFile(join(ROOT, 'notes.txt'), 'plain\n', 'utf8')
await writeFile(join(ROOT, 'data.csv'), 'a,b\n1,2\n', 'utf8')
await writeFile(join(ROOT, 'page.html'), '<h1>x</h1>', 'utf8')
await writeFile(join(ROOT, 'main.py'), 'print(1)\n', 'utf8')
await writeFile(join(ROOT, 'binary.bin'), Buffer.from([0, 1, 2, 3]))
await writeFile(join(ROOT, '.hidden.md'), '# hidden\n', 'utf8')
await mkdir(join(ROOT, 'sub'), { recursive: true })
await writeFile(join(ROOT, 'sub', 'deep.md'), '# deep\n', 'utf8')
await mkdir(join(ROOT, 'node_modules'), { recursive: true })
await writeFile(join(ROOT, 'node_modules', 'dep.md'), '# dep\n', 'utf8')

console.log('route registration')

await test('registers the four documented route families', () => {
	const paths = routes.map((r) => r.path).sort()
	assert.deepEqual(paths, ['/mdvault/api', '/mdvault/asset', '/mdvault/mermaid.js', '/mdvault/sheet', '/mdvault/xlsx.js'].sort())
})

console.log('/mdvault/api list')

const api = routeFor('/mdvault/api')

await test('lists previewable files and skips dotfiles, node_modules and binaries', async () => {
	const res = await call(api, { method: 'POST', url: '/mdvault/api/list', body: JSON.stringify({}) })
	assert.equal(res.statusCode, 200)
	const out = json(res)
	assert.equal(out.ok, true)
	const paths = out.files.map((f) => f.path)
	assert.ok(paths.includes('README.md'), paths.join(','))
	assert.ok(paths.includes('notes.txt'), paths.join(','))
	assert.ok(paths.includes('data.csv'), paths.join(','))
	assert.ok(paths.includes('page.html'), paths.join(','))
	assert.ok(paths.includes('main.py'), paths.join(','))
	assert.ok(paths.includes('sub/deep.md'), paths.join(','))
	assert.ok(!paths.includes('.hidden.md'), 'dotfile must be skipped')
	assert.ok(!paths.includes('node_modules/dep.md'), 'node_modules must be skipped')
	assert.ok(!paths.includes('binary.bin'), 'unknown binary must be skipped')
})

await test('rejects a non-POST method', async () => {
	const res = await call(api, { method: 'GET', url: '/mdvault/api/list' })
	assert.equal(res.statusCode, 405)
	assert.equal(json(res).ok, false)
})

await test('an unknown method returns 404 with a JSON body', async () => {
	const res = await call(api, { method: 'POST', url: '/mdvault/api/nope', body: JSON.stringify({}) })
	assert.equal(res.statusCode, 404)
	assert.equal(json(res).ok, false)
})

await test('lists files nested far deeper than the old 6-level limit', async () => {
	// The original walk stopped at depth 6, so deep documents fell out of the
	// listing — which also broke relative links to them.
	const deepDir = join(ROOT, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i')
	await mkdir(deepDir, { recursive: true })
	await writeFile(join(deepDir, 'deepnote.md'), '# deep\n', 'utf8')
	const res = await call(api, { method: 'POST', url: '/mdvault/api/list', body: JSON.stringify({}) })
	const paths = json(res).files.map((f) => f.path)
	assert.ok(paths.includes('a/b/c/d/e/f/g/h/i/deepnote.md'), 'deep file missing from: ' + paths.join(','))
})

await test('reports the truncation flag and the depth limit', async () => {
	const res = await call(api, { method: 'POST', url: '/mdvault/api/list', body: JSON.stringify({}) })
	const out = json(res)
	assert.equal(typeof out.truncated, 'boolean')
	assert.equal(typeof out.maxDepth, 'number')
	assert.ok(out.maxDepth >= 10, 'the depth limit should allow real document trees')
})

console.log('/mdvault/api read + write')

await test('reads a text file', async () => {
	const res = await call(api, { method: 'POST', url: '/mdvault/api/read', body: JSON.stringify({ path: 'README.md' }) })
	const out = json(res)
	assert.equal(out.ok, true)
	assert.equal(out.text, '# hi\n')
})

await test('reads a nested file', async () => {
	const res = await call(api, { method: 'POST', url: '/mdvault/api/read', body: JSON.stringify({ path: 'sub/deep.md' }) })
	assert.equal(json(res).text, '# deep\n')
})

await test('refuses a parent traversal', async () => {
	const res = await call(api, { method: 'POST', url: '/mdvault/api/read', body: JSON.stringify({ path: '../outside.md' }) })
	assert.equal(json(res).ok, false)
})

await test('refuses an absolute path', async () => {
	for (const p of ['/etc/passwd', 'C:/Windows/win.ini', '\\\\server\\share\\x.md']) {
		const res = await call(api, { method: 'POST', url: '/mdvault/api/read', body: JSON.stringify({ path: p }) })
		assert.equal(json(res).ok, false, p)
	}
})

await test('refuses a dot-prefixed segment', async () => {
	const res = await call(api, { method: 'POST', url: '/mdvault/api/read', body: JSON.stringify({ path: '.git/config' }) })
	assert.equal(json(res).ok, false)
})

await test('writes a file and reads it back', async () => {
	const w = await call(api, { method: 'POST', url: '/mdvault/api/write', body: JSON.stringify({ path: 'sub/written.md', text: '# written\n' }) })
	assert.equal(json(w).ok, true)
	const r = await call(api, { method: 'POST', url: '/mdvault/api/read', body: JSON.stringify({ path: 'sub/written.md' }) })
	assert.equal(json(r).text, '# written\n')
})

await test('refuses a write traversal', async () => {
	const res = await call(api, { method: 'POST', url: '/mdvault/api/write', body: JSON.stringify({ path: '../escape.md', text: 'x' }) })
	assert.equal(json(res).ok, false)
})

await test('refuses a write without text', async () => {
	const res = await call(api, { method: 'POST', url: '/mdvault/api/write', body: JSON.stringify({ path: 'a.md' }) })
	assert.equal(json(res).ok, false)
})

console.log('/mdvault/asset')

const asset = routeFor('/mdvault/asset')

await test('serves a file with the right content type', async () => {
	const cases = [
		['README.md', 'text/plain; charset=utf-8'],
		['page.html', 'text/html; charset=utf-8'],
		['main.py', 'text/plain; charset=utf-8'],
		['data.csv', 'text/plain; charset=utf-8'],
	]
	for (const [rel, ct] of cases) {
		const res = await call(asset, { method: 'GET', url: '/mdvault/asset/sess/' + rel })
		assert.equal(res.statusCode, 200, rel)
		assert.equal(res.headers['content-type'], ct, rel)
		assert.equal(res.headers['x-content-type-options'], 'nosniff', rel)
	}
})

await test('serves binary bytes intact', async () => {
	const res = await call(asset, { method: 'GET', url: '/mdvault/asset/sess/binary.bin' })
	assert.equal(res.statusCode, 200)
	assert.equal(res.headers['content-type'], 'application/octet-stream')
	assert.deepEqual([...res.body], [0, 1, 2, 3])
})

await test('answers HEAD with headers but no body', async () => {
	const res = await call(asset, { method: 'HEAD', url: '/mdvault/asset/sess/README.md' })
	assert.equal(res.statusCode, 200)
	assert.equal(res.body, null)
	assert.ok(Number(res.headers['content-length']) > 0)
})

await test('404s a missing file', async () => {
	const res = await call(asset, { method: 'GET', url: '/mdvault/asset/sess/nope.md' })
	assert.equal(res.statusCode, 404)
})

await test('400s a traversal in the asset path', async () => {
	const res = await call(asset, { method: 'GET', url: '/mdvault/asset/sess/..%2F..%2Fetc%2Fpasswd' })
	assert.ok(res.statusCode === 400 || res.statusCode === 404, 'got ' + res.statusCode)
})

await test('404s a malformed asset url', async () => {
	const res = await call(asset, { method: 'GET', url: '/mdvault/asset/nosession' })
	assert.equal(res.statusCode, 404)
})

console.log('vendored libraries')

await test('/mdvault/mermaid.js serves the bundle with an ETag', async () => {
	const res = await call(routeFor('/mdvault/mermaid.js'), { method: 'GET', url: '/mdvault/mermaid.js' })
	assert.equal(res.statusCode, 200)
	assert.equal(res.headers['content-type'], 'application/javascript; charset=utf-8')
	assert.ok(Number(res.headers['content-length']) > 1000000, 'expected a multi-megabyte bundle')
	assert.ok(typeof res.headers.etag === 'string' && res.headers.etag.startsWith('"'))
	// The bundle assigns the global the client looks for.
	assert.ok(res.body.toString('utf8').includes('globalThis["mermaid"]'))
})

await test('/mdvault/mermaid.js honours If-None-Match with a 304', async () => {
	const first = await call(routeFor('/mdvault/mermaid.js'), { method: 'GET', url: '/mdvault/mermaid.js' })
	const second = await call(routeFor('/mdvault/mermaid.js'), {
		method: 'GET', url: '/mdvault/mermaid.js', headers: { 'if-none-match': first.headers.etag },
	})
	assert.equal(second.statusCode, 304)
	assert.equal(second.body, null)
})

await test('/mdvault/xlsx.js serves the bundle', async () => {
	const res = await call(routeFor('/mdvault/xlsx.js'), { method: 'GET', url: '/mdvault/xlsx.js' })
	assert.equal(res.statusCode, 200)
	assert.equal(res.headers['content-type'], 'application/javascript; charset=utf-8')
	assert.ok(Number(res.headers['content-length']) > 100000)
})

console.log('/mdvault/sheet')

await test('renders the spreadsheet viewer page for a real sheet', async () => {
	const res = await call(routeFor('/mdvault/sheet'), { method: 'GET', url: '/mdvault/sheet?sessionId=s&path=data.csv' })
	assert.equal(res.statusCode, 200)
	assert.equal(res.headers['content-type'], 'text/html; charset=utf-8')
	const html = res.body.toString('utf8')
	assert.ok(html.includes('/mdvault/xlsx.js'), 'page must load the bundled lib')
	assert.ok(html.includes('/mdvault/asset/'), 'page must fetch through the asset route')
})

await test('400s without a path', async () => {
	const res = await call(routeFor('/mdvault/sheet'), { method: 'GET', url: '/mdvault/sheet?sessionId=s' })
	assert.equal(res.statusCode, 400)
})

await test('404s a missing sheet', async () => {
	const res = await call(routeFor('/mdvault/sheet'), { method: 'GET', url: '/mdvault/sheet?sessionId=s&path=nope.csv' })
	assert.equal(res.statusCode, 404)
})

await rm(ROOT, { recursive: true, force: true })

console.log('')
console.log(passed + ' assertions passed' + (failures.length ? ', ' + failures.length + ' FAILED' : ''))
if (failures.length) {
	console.log('failed: ' + failures.join(' | '))
}
