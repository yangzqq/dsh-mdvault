/**
 * dsh-mdvault host half.
 *
 * Owns three same-origin HTTP route families plus nothing else:
 * - POST /mdvault/api/<list|read|write>  JSON API for the client view
 * - GET  /mdvault/asset/<sessionId>/<rel>  raw bytes of one workspace file
 * - GET  /mdvault/sheet?sessionId&path     generated SheetJS viewer page
 * - GET  /mdvault/xlsx.js                  the bundled SheetJS library
 *
 * Every file access resolves against the calling session's cwd (falling back
 * to the deployment's sandboxPolicy root), rejects `..`/dot segments, and goes
 * through the ctx.fs service so deployment file policy still applies.
 */
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-mdvault'

export const inject = ['fs', 'webServer']

const encoder = new TextEncoder()
const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const XLSX_DIST = join(DIST_DIR, 'xlsx.full.min.js')
const MERMAID_DIST = join(DIST_DIR, 'mermaid.min.js')

/** Largest text file the online editor will load (readText itself is uncapped). */
const MAX_TEXT_BYTES = 6 * 1024 * 1024

/** Largest single asset served to the browser (matches the readBytes call). */
const MAX_ASSET_BYTES = 268435456

/**
 * Vendored browser libraries, cached by (path, mtime, size) so a replaced
 * `dist/` file is picked up without a restart. Both are multi-megabyte, so
 * they carry an ETag and answer If-None-Match with 304.
 */
const distCache = new Map()

async function loadDist(absPath) {
	const info = await stat(absPath)
	const key = absPath + ':' + info.mtimeMs + ':' + info.size
	const cached = distCache.get(absPath)
	if (cached && cached.key === key) return cached
	const bytes = await readFile(absPath)
	const entry = {
		key,
		bytes,
		etag: '"' + createHash('sha1').update(bytes).digest('hex').slice(0, 20) + '"',
	}
	distCache.set(absPath, entry)
	return entry
}

function serveDist(req, res, entry, contentType) {
	if (req.headers['if-none-match'] === entry.etag) {
		res.writeHead(304, { ETag: entry.etag, 'Cache-Control': 'no-cache' })
		res.end()
		return
	}
	res.writeHead(200, {
		'Content-Type': contentType,
		'Content-Length': entry.bytes.byteLength,
		'Cache-Control': 'no-cache',
		ETag: entry.etag,
	})
	if (req.method === 'HEAD') { res.end(); return }
	res.end(entry.bytes)
}

/** The cwd off a record that carries an immutable session header. */
function headerCwdOf(record) {
	const header = record && record.header
	const cwd = header && header.cwd
	return typeof cwd === 'string' && cwd ? cwd : undefined
}

/**
 * Resolved session cwd per session id.
 *
 * Positive results only. A session's cwd lives on its IMMUTABLE header, fixed at
 * create, so a hit can never go stale. Misses are deliberately not cached: an
 * id that fails to resolve now may resolve once the session materializes.
 */
const sessionCwdCache = new Map()

/**
 * Resolve a session's working directory.
 *
 * The order is load-bearing. A live session carries its cwd on the in-memory
 * header. A HISTORICAL session — one reopened from the conversation list — is
 * not in that in-memory registry at all, so the first lookup returns nothing,
 * and falling straight through to the deployment-wide workspace root made every
 * historical conversation browse that root instead of its own project.
 *
 * The persisted header is the authoritative source for those, which is why
 * `sessionPersistence` is consulted before any fallback.
 *
 * @returns the absolute cwd, or undefined when it cannot be determined.
 */
async function sessionCwd(ctx, sessionId) {
	if (typeof sessionId !== 'string' || !sessionId) return undefined
	const cached = sessionCwdCache.get(sessionId)
	if (cached !== undefined) return cached

	// 1. Live session: cheapest, and its header is always current.
	const sessions = ctx.get('sessions')
	if (sessions && typeof sessions.get === 'function') {
		const cwd = headerCwdOf(sessions.get(sessionId))
		if (cwd) { sessionCwdCache.set(sessionId, cwd); return cwd }
	}

	// 2. Historical session: read the STORED header. `stat` returns it without
	//    reading the event log and without taking write ownership, so this is
	//    safe even while the session is live in another process.
	//
	//    `sessionPersistence` is optional: a stripped-down host simply has no
	//    such service and falls through to the workspace root below.
	const persistence = ctx.get('sessionPersistence')
	if (persistence && typeof persistence.stat === 'function') {
		try {
			const cwd = headerCwdOf(await persistence.stat(sessionId))
			if (cwd) { sessionCwdCache.set(sessionId, cwd); return cwd }
		} catch (err) {
			// Unknown/unreadable session is not an error here; the caller still
			// has the workspace fallback.
			console.error('[dsh-mdvault] could not read session header for', sessionId, err && err.message)
		}
	}

	return undefined
}

/**
 * The directory this call should browse, plus whether it is the session's own.
 *
 * `resolved` distinguishes "the session's real project" from "we could not tell,
 * so here is the deployment default" — the client surfaces the difference
 * instead of silently showing an unrelated directory.
 *
 * @returns {{root: string, resolved: boolean, source: string}}
 */
async function resolveRoot(ctx, sessionId) {
	const cwd = await sessionCwd(ctx, sessionId)
	if (cwd) return { root: cwd, resolved: true, source: 'session' }

	const policy = ctx.get('sandboxPolicy')
	const fallback = policy && policy.workspaceRoot
	if (typeof fallback === 'string' && fallback) {
		return { root: fallback, resolved: false, source: 'workspaceRoot' }
	}
	return { root: process.cwd(), resolved: false, source: 'process' }
}

function safeRel(raw) {
	if (typeof raw !== 'string') return null
	if (raw.length > 400) return null
	const norm = raw.replace(/\\/g, '/')
	if (norm.charAt(0) === '/' || /^[a-zA-Z]:/.test(norm)) return null
	const segs = norm.split('/').filter((s) => s.length > 0)
	if (!segs.length || segs.length > 24) return null
	for (const s of segs) {
		if (s === '..' || s === '.' || s.charAt(0) === '.') return null
	}
	return segs.join('/')
}

function queryParam(rawUrl, name) {
	const s = String(rawUrl || '')
	const qi = s.indexOf('?')
	if (qi < 0) return null
	const prefix = name + '='
	for (const part of s.slice(qi + 1).split('&')) {
		if (part.indexOf(prefix) === 0) {
			try { return decodeURIComponent(part.slice(prefix.length).replace(/\+/g, '%20')) } catch { return part.slice(prefix.length) }
		}
	}
	return null
}

/**
 * Previewable file extensions. Beyond the original document/image/spreadsheet
 * set this now claims the whole plain-text/code family (the better-sidebar
 * `code` catch-all) plus HTML, so the tree lists everything the main-window
 * viewers can actually render.
 */
/**
 * Extension knowledge, defined ONCE.
 *
 * These families previously existed as three independent, heavily overlapping
 * regexes (the tree listing, the text/plain content type, and the JSON content
 * type), so adding an extension meant remembering to update several places and
 * they had already drifted. Everything below is derived from these lists.
 */

/** Plain text and source code — listed in the tree, served as text/plain. */
const TEXT_EXTS = [
	// markdown
	'md', 'markdown', 'mdx',
	// plain text / data
	'txt', 'log', 'json', 'json5', 'jsonc', 'ndjson', 'yaml', 'yml', 'toml',
	'ini', 'cfg', 'conf', 'properties', 'env', 'xml', 'plist', 'csv', 'tsv',
	// styles
	'css', 'scss', 'sass', 'less', 'styl',
	// code
	'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
	'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift', 'dart',
	'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'cs', 'm', 'mm', 'php',
	'lua', 'pl', 'pm', 'r', 'jl', 'ex', 'exs', 'erl', 'hs', 'clj', 'groovy',
	'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'sql',
	'graphql', 'gql', 'proto', 'thrift', 'gradle', 'cmake', 'mk', 'tex', 'bib',
	'diff', 'patch', 'rst', 'adoc', 'org', 'srt', 'vtt',
]

/** Served as application/json rather than text/plain (a subset of TEXT_EXTS). */
const JSON_EXTS = ['json', 'json5', 'jsonc', 'ndjson', 'map', 'webmanifest', 'ipynb']

/** Extension → image MIME. */
const IMAGE_TYPES = {
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
	svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
	ico: 'image/x-icon', avif: 'image/avif',
}

/** Spreadsheet formats; the SheetJS viewer handles them client-side. */
const SHEET_EXTS = ['xlsx', 'xlsm', 'xls', 'csv', 'tsv']

/** Extension → MIME, built from the families above. */
const CONTENT_TYPES = new Map()
for (const ext of TEXT_EXTS) CONTENT_TYPES.set(ext, 'text/plain; charset=utf-8')
for (const ext of JSON_EXTS) CONTENT_TYPES.set(ext, 'application/json; charset=utf-8')
for (const ext of Object.keys(IMAGE_TYPES)) CONTENT_TYPES.set(ext, IMAGE_TYPES[ext])
CONTENT_TYPES.set('pdf', 'application/pdf')
// HTML is deliberately served as text/html: the client renders it inside a
// sandboxed iframe WITHOUT allow-same-origin, so the previewed page lands in an
// opaque origin and cannot reach the GUI's own session.
CONTENT_TYPES.set('html', 'text/html; charset=utf-8')
CONTENT_TYPES.set('htm', 'text/html; charset=utf-8')

/** Extensions the tree listing claims: every text family plus the binary ones. */
const TREE_EXTS = [
	...TEXT_EXTS, ...SHEET_EXTS, ...Object.keys(IMAGE_TYPES), 'pdf', 'html', 'htm',
]

/** Matches a name whose extension the tree should list. */
const TREE_RE = new RegExp('\\.(' + TREE_EXTS.join('|') + ')$', 'i')

/** Extension-less files that are still plain text and worth previewing. */
const TEXT_NAMES = new Set([
	'dockerfile', 'makefile', 'cmakelists.txt', 'procfile', 'gemfile', 'rakefile',
	'vagrantfile', 'justfile', 'brewfile', 'license', 'licence', 'notice',
	'readme', 'changelog', 'authors', 'contributing', 'codeowners',
])

/**
 * Directory-nesting limit for the tree walk. Real document workspaces nest far
 * deeper than the original 6 levels (project/phase/year/customer/...), and
 * anything past the limit silently fell out of the listing — which also broke
 * relative links to it, because the client could no longer see the file.
 */
const MAX_WALK_DEPTH = 14

/** File-count ceiling for one listing; `truncated` reports when it bites. */
const MAX_TREE_FILES = 4000

async function walk(fs, target, prefix, depth, out, state) {
	if (depth > MAX_WALK_DEPTH || out.length >= MAX_TREE_FILES) {
		if (out.length >= MAX_TREE_FILES) state.truncated = true
		return
	}
	let entries
	try {
		entries = await fs.listDir(target)
	} catch {
		return
	}
	if (!Array.isArray(entries)) return
	for (const entry of entries) {
		if (out.length >= MAX_TREE_FILES) { state.truncated = true; return }
		const name = entry && typeof entry.name === 'string' ? entry.name : ''
		if (!name || name.charAt(0) === '.') continue
		if (name.toLowerCase() === 'node_modules') continue
		const rel = prefix ? prefix + '/' + name : name
		if (entry.type === 'directory') {
			await walk(fs, entry.target, rel, depth + 1, out, state)
		} else if (TREE_RE.test(name) || TEXT_NAMES.has(name.toLowerCase())) {
			out.push({ path: rel, name })
		}
	}
}

/**
 * Content type for one served file. A table lookup over CONTENT_TYPES (built
 * from the same extension families the tree uses), so the two can never
 * disagree about what a given extension is.
 */
function contentTypeOf(path) {
	const p = String(path || '').toLowerCase()
	const dot = p.lastIndexOf('.')
	const slash = p.lastIndexOf('/')
	if (dot <= slash) {
		// No extension: extension-less text files still deserve a text type.
		const base = p.slice(slash + 1)
		return TEXT_NAMES.has(base) ? 'text/plain; charset=utf-8' : 'application/octet-stream'
	}
	return CONTENT_TYPES.get(p.slice(dot + 1)) || 'application/octet-stream'
}

function sheetPageHtml(libUrl, srcUrl, fileName) {
	return '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>' + fileName + '</title><style>' +
		'body{margin:0;font:13px/1.5 system-ui,"Segoe UI",sans-serif;background:#fff;color:#1f2328}' +
		'#bar{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid rgba(0,0,0,.12);position:sticky;top:0;background:#fff;z-index:2;flex-wrap:wrap}' +
		'.tab{padding:4px 14px;border-radius:6px;border:1px solid rgba(0,0,0,.15);background:transparent;cursor:pointer;font-size:12px;color:#1f2328}' +
		'.tab.on{background:#2563eb;color:#fff;border-color:#2563eb}' +
		'#wrap{overflow:auto;max-height:calc(100vh - 46px)}' +
		'table{border-collapse:collapse;font-size:12px;margin:10px}' +
		'td,th{border:1px solid rgba(0,0,0,.18);padding:3px 10px;white-space:pre-wrap;max-width:420px;vertical-align:top}' +
		'tr:first-child td{background:#f3f4f6;font-weight:600}' +
		'#msg{padding:30px;text-align:center;color:#666}' +
		'</style></head><body><div id="bar"></div><div id="wrap"><div id="msg">正在解析工作簿…</div></div>' +
		'<script src="' + libUrl + '"><\/script>' +
		'<script>(function(){var LIB=window.XLSX,SRC=' + JSON.stringify(srcUrl) + ',NAME=' + JSON.stringify(fileName) + ';' +
		'if(!LIB){document.getElementById("msg").textContent="SheetJS 库加载失败";return}' +
		'fetch(SRC,{credentials:"omit"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.arrayBuffer()})' +
		'.then(function(buf){var wb=LIB.read(buf,{type:"array"});var bar=document.getElementById("bar"),wrap=document.getElementById("wrap");' +
		'var names=wb.SheetNames;function show(i){var ws=wb.Sheets[names[i]];var ref=ws["!ref"]||"A1";var rng=LIB.utils.decode_range(ref);' +
		'if(rng.e.r>rng.s.r+800||rng.e.c>rng.s.c+80){rng.e.r=Math.min(rng.e.r,rng.s.r+800);rng.e.c=Math.min(rng.e.c,rng.s.c+80);' +
		'ws=Object.assign({},ws);ws["!ref"]=LIB.utils.encode_range(rng)}wrap.innerHTML=LIB.utils.sheet_to_html(ws,{editable:false});' +
		'var kids=bar.children;for(var k=0;k<kids.length;k++)kids[k].className=(k===i)?"tab on":"tab"}' +
		'names.forEach(function(n,i){var b=document.createElement("button");b.className="tab";b.textContent=n;b.onclick=function(){show(i)};bar.appendChild(b)});' +
		'if(names.length){show(0)}else{document.getElementById("msg").textContent="空工作簿"}})' +
		'.catch(function(e){document.getElementById("msg").textContent="读取失败："+e.message})})();<\/script>' +
		'</body></html>'
}

async function readJsonBody(req) {
	const chunks = []
	let total = 0
	for await (const chunk of req) {
		total += chunk.length
		if (total > 16 * 1024 * 1024) throw new Error('body too large')
		chunks.push(chunk)
	}
	const text = Buffer.concat(chunks).toString('utf8')
	if (!text) return {}
	return JSON.parse(text)
}

export function apply(ctx) {
	const fs = ctx.fs

	function sendJson(res, status, value) {
		const body = JSON.stringify(value)
		res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
		res.end(body)
	}

	// ── JSON API ───────────────────────────────────────────────────────────
	ctx.effect(() => ctx.webServer.register({
		kind: 'prefix',
		path: '/mdvault/api',
		handler: async (req, res) => {
			try {
				if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
				const url = String(req.url || '/')
				const qi = url.indexOf('?')
				const pathPart = qi >= 0 ? url.slice(0, qi) : url
				const method = pathPart.replace(/^\/mdvault\/api\/?/, '').replace(/\/+$/, '')
				const body = await readJsonBody(req)
				const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
				if (method === 'list') {
					const resolved = await resolveRoot(ctx, sessionId)
					const rootTarget = await fs.resolve(resolved.root)
					const files = []
					const state = { truncated: false }
					await walk(fs, rootTarget, '', 0, files, state)
					files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
					sendJson(res, 200, {
						ok: true,
						root: resolved.root,
						// `resolved: false` means the session's own directory could
						// not be determined and this is the deployment default —
						// the client warns instead of presenting it as the project.
						resolved: resolved.resolved,
						rootSource: resolved.source,
						files,
						// Surfaces the cap instead of silently hiding files, which
						// is what made relative links to deep files fail.
						truncated: state.truncated,
						maxDepth: MAX_WALK_DEPTH,
						assetPrefix: '/mdvault/asset',
						sheetPrefix: '/mdvault/sheet',
					})
					return
				}
				if (method === 'read') {
					const rel = safeRel(body.path)
					if (!rel) { sendJson(res, 200, { ok: false, error: '非法或越界的文件路径' }); return }
					const root = (await resolveRoot(ctx, sessionId)).root
					const target = await fs.resolve(rel, { cwd: root })
					const info = await fs.stat(target)
					if (info && info.type === 'directory') { sendJson(res, 200, { ok: false, error: '目标是目录，不是文件' }); return }
					// readText has no size cap; refuse absurd text files before
					// reading them into the response body.
					if (info && typeof info.size === 'number' && info.size > MAX_TEXT_BYTES) {
						sendJson(res, 200, {
							ok: false,
							error: '文件过大（' + Math.round(info.size / 1048576) + 'MB），超过 ' + (MAX_TEXT_BYTES / 1048576) + 'MB 的在线编辑上限',
						})
						return
					}
					const text = await fs.readText(target)
					sendJson(res, 200, { ok: true, path: rel, text, size: info ? info.size : undefined })
					return
				}
				if (method === 'write') {
					const rel = safeRel(body.path)
					if (!rel) { sendJson(res, 200, { ok: false, error: '非法或越界的文件路径' }); return }
					const text = typeof body.text === 'string' ? body.text : null
					if (text === null) { sendJson(res, 200, { ok: false, error: '缺少文本内容' }); return }
					if (text.length > 8 * 1024 * 1024) { sendJson(res, 200, { ok: false, error: '内容超过 8MB 上限' }); return }
					const root = (await resolveRoot(ctx, sessionId)).root
					const target = await fs.resolve(rel, { cwd: root })
					const outcome = await fs.writeText(target, text)
					sendJson(res, 200, { ok: true, operation: outcome && outcome.operation })
					return
				}
				sendJson(res, 404, { ok: false, error: 'unknown method "' + method + '"' })
			} catch (err) {
				console.error('[dsh-mdvault] api failed:', err)
				sendJson(res, 200, { ok: false, error: (err && err.message) || String(err) })
			}
		},
	}), 'dsh-mdvault: json api')

	// ── Raw bytes ──────────────────────────────────────────────────────────
	ctx.effect(() => ctx.webServer.register({
		kind: 'prefix',
		path: '/mdvault/asset',
		handler: async (req, res) => {
			try {
				const rawUrl = String(req.url || '')
				const rest = rawUrl.slice('/mdvault/asset'.length + 1)
				const slash = rest.indexOf('/')
				if (slash <= 0) { res.statusCode = 404; res.end('not found'); return }
				const sid = rest.slice(0, slash)
				let rel = rest.slice(slash + 1)
				const qmark = rel.indexOf('?')
				if (qmark >= 0) rel = rel.slice(0, qmark)
				const hashmark = rel.indexOf('#')
				if (hashmark >= 0) rel = rel.slice(0, hashmark)
				try { rel = decodeURIComponent(rel) } catch { /* keep raw */ }
				rel = safeRel(rel)
				if (!rel) { res.statusCode = 400; res.end('bad path'); return }
				const root = (await resolveRoot(ctx, sid)).root
				const target = await fs.resolve(rel, { cwd: root })
				const info = await fs.stat(target)
				if (!info || info.type !== 'file') { res.statusCode = 404; res.end('not found'); return }
				const bytes = await fs.readBytes(target, undefined, MAX_ASSET_BYTES)
				res.writeHead(200, {
					'Content-Type': contentTypeOf(rel),
					'Content-Length': bytes.byteLength,
					'Cache-Control': 'no-store',
					'X-Content-Type-Options': 'nosniff',
				})
				if (req.method === 'HEAD') { res.end(); return }
				res.end(bytes)
			} catch (err) {
				console.error('[dsh-mdvault] asset failed:', err)
				try { res.statusCode = 500; res.end('serve error') } catch { /* already sent */ }
			}
		},
	}), 'dsh-mdvault: raw bytes')

	// ── Bundled SheetJS library ────────────────────────────────────────────
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/mdvault/xlsx.js',
		handler: async (req, res) => {
			try {
				serveDist(req, res, await loadDist(XLSX_DIST), 'application/javascript; charset=utf-8')
			} catch (err) {
				console.error('[dsh-mdvault] xlsx lib failed:', err)
				try { res.statusCode = 500; res.end('// lib missing') } catch { /* already sent */ }
			}
		},
	}), 'dsh-mdvault: xlsx lib')

	// ── Bundled Mermaid library (loaded lazily, only for mermaid fences) ───
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: '/mdvault/mermaid.js',
		handler: async (req, res) => {
			try {
				serveDist(req, res, await loadDist(MERMAID_DIST), 'application/javascript; charset=utf-8')
			} catch (err) {
				console.error('[dsh-mdvault] mermaid lib failed:', err)
				try { res.statusCode = 500; res.end('// lib missing') } catch { /* already sent */ }
			}
		},
	}), 'dsh-mdvault: mermaid lib')

	// ── Spreadsheet viewer page ────────────────────────────────────────────
	ctx.effect(() => ctx.webServer.register({
		kind: 'prefix',
		path: '/mdvault/sheet',
		handler: async (req, res) => {
			try {
				const sid = queryParam(req.url, 'sessionId') || ''
				const rel = safeRel(queryParam(req.url, 'path') || '')
				if (!sid || !rel) {
					res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
					res.end('bad request')
					return
				}
				const root = (await resolveRoot(ctx, sid)).root
				const target = await fs.resolve(rel, { cwd: root })
				const info = await fs.stat(target)
				if (!info || info.type !== 'file') {
					res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
					res.end('file not found')
					return
				}
				const libUrl = '/mdvault/xlsx.js'
				const srcUrl = '/mdvault/asset/' + encodeURIComponent(sid) + '/' + encodeURIComponent(rel)
				const html = sheetPageHtml(libUrl, srcUrl, rel.split('/').pop())
				const byteLength = encoder.encode(html).length
				res.writeHead(200, {
					'Content-Type': 'text/html; charset=utf-8',
					'Content-Length': byteLength,
					'Cache-Control': 'no-store',
					'X-Content-Type-Options': 'nosniff',
				})
				res.end(html)
			} catch (err) {
				console.error('[dsh-mdvault] sheet failed:', err)
				try { res.statusCode = 500; res.end('serve error') } catch { /* already sent */ }
			}
		},
	}), 'dsh-mdvault: sheet viewer')
}
