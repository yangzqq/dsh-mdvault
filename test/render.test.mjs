/**
 * Component render tests for dsh-mdvault's client half.
 *
 * Why this file exists: the previous suites exercised only pure helpers and
 * apply(). Nothing ever executed the component bodies, so a
 * temporal-dead-zone ReferenceError inside MdVaultView (a `const` read above
 * its declaration) shipped and blanked the whole tab. Pure-function tests
 * cannot catch that class of bug — rendering can.
 *
 * The harness is a compact React implementation: createElement, position-indexed
 * hooks (useState/useMemo/useRef/useEffect/useCallback/memo), a re-render loop
 * that settles promise-driven state updates, and DOM/fetch stubs. It is
 * deliberately strict about hook ordering, because a hook-count change between
 * renders is fatal in real React too.
 *
 * Run: node test/render.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

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
		console.error('      ' + ((err && err.stack) || err))
		process.exitCode = 1
	}
}

// ── minimal React ───────────────────────────────────────────────────────────

let current = null
let dirty = false
let effectQueue = []

function el(type, props, ...children) {
	const merged = Object.assign({}, props)
	if (children.length === 1) merged.children = children[0]
	else if (children.length > 1) merged.children = children
	return { $$el: true, type, props: merged }
}

/** Next hook slot for the rendering component; detects ordering errors. */
function slot() {
	if (current === null) throw new Error('hook called outside render')
	return current.slot++
}

function sameDeps(a, b) {
	if (!a || !b) return false
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
	return true
}

const React = {
	createElement: el,
	memo: (fn) => fn,
	useState(init) {
		const i = slot()
		// Capture the instance: the setter is called later (from an effect or a
		// promise callback) when `current` no longer points at this component.
		const inst = current
		if (!(i in inst.hooks)) inst.hooks[i] = typeof init === 'function' ? init() : init
		return [inst.hooks[i], (v) => {
			const next = typeof v === 'function' ? v(inst.hooks[i]) : v
			if (Object.is(next, inst.hooks[i])) return
			inst.hooks[i] = next
			dirty = true
		}]
	},
	useMemo(fn, deps) {
		const i = slot()
		const prev = current.memoDeps[i]
		if (prev === undefined || !sameDeps(prev, deps)) {
			current.hooks[i] = fn()
			current.memoDeps[i] = deps
		}
		return current.hooks[i]
	},
	useRef(v) {
		const i = slot()
		if (!(i in current.hooks)) current.hooks[i] = { current: v }
		return current.hooks[i]
	},
	useCallback(fn, deps) { return React.useMemo(() => fn, deps) },
	useEffect(fn, deps) {
		const i = slot()
		const inst = current
		const prev = inst.effectDeps[i]
		if (prev === undefined || !sameDeps(prev, deps)) {
			inst.effectDeps[i] = deps
			effectQueue.push(() => {
				// React runs the previous cleanup before re-running an effect.
				if (typeof inst.cleanups[i] === 'function') inst.cleanups[i]()
				const result = fn()
				inst.cleanups[i] = typeof result === 'function' ? result : null
			})
		}
	},
}

// ── DOM + fetch stubs ───────────────────────────────────────────────────────

const headChildren = []
function makeEl(tag) {
	return {
		tagName: tag, id: '', textContent: '', className: '', children: [], classList: [],
		nodeType: 1, style: {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null },
		addEventListener() {}, removeEventListener() {}, remove() {},
		appendChild(c) { this.children.push(c) },
		replaceChildren() {}, querySelector() { return null }, querySelectorAll() { return [] },
	}
}
const document = {
	head: { appendChild: (e) => headChildren.push(e) },
	getElementById: (id) => headChildren.find((e) => e.id === id) ?? null,
	createElement: makeEl,
	body: {
		attrs: {},
		hasAttribute(name) { return name in this.attrs },
		setAttribute(name, value) { this.attrs[name] = value },
		removeAttribute(name) { delete this.attrs[name] },
		getAttribute(name) { return name in this.attrs ? this.attrs[name] : null },
	},
	addEventListener() {}, removeEventListener() {},
}

/** api() responses, keyed by the method segment of /mdvault/api/<method>. */
const apiResponses = new Map()
let fetchCalls = []

function installFetch() {
	const f = (url, opts) => {
		fetchCalls.push(url)
		const method = String(url).split('/').pop()
		const value = apiResponses.get(method)
		if (value === undefined) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
		return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) })
	}
	return f
}

// ── module load ─────────────────────────────────────────────────────────────

const documentListeners = []
const markdownTextCalls = []

/** A stand-in for the platform MarkdownText; records its props. */
function MarkdownTextStub(props) {
	markdownTextCalls.push(props)
	return el('div', { className: 'fake-markdown' }, props.text)
}

/**
 * Load a FRESH copy of the client module. The plugin resolves
 * MarkdownText once, at factory time, so whether the platform primitives are
 * present has to be decided when the module is loaded — a module loaded
 * without them can never be made to use them afterwards.
 */
function loadMod(withPrimitives) {
	let registration = null
	const sandbox = {
		window: {
			__ModuleLoader__: { load: (s) => { registration = s } },
			location: { origin: 'http://127.0.0.1:3080' },
			confirm: () => true,
			matchMedia: () => ({ matches: false }),
		},
		document: Object.assign({}, document, {
			addEventListener: (t, fn, c) => documentListeners.push({ type: t, fn, capture: c }),
			removeEventListener: () => {},
		}),
		console,
		URL, URLSearchParams, AbortController, Promise, Date, Math, JSON, Object, Array,
		String, Number, RegExp, Error, WeakMap, Map, Set, Symbol,
		setTimeout, clearTimeout, requestAnimationFrame: (fn) => setTimeout(fn, 0),
		fetch: installFetch(),
	}
	sandbox.globalThis = sandbox
	vm.createContext(sandbox)
	vm.runInContext(source, sandbox, { filename: 'client.js' })

	return registration.factory((spec) => {
		if (spec === 'react') return React
		if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
			if (!withPrimitives) throw new Error('primitive not available in this harness')
			return { MarkdownText: MarkdownTextStub }
		}
		throw new Error('unexpected require: ' + spec)
	})
}

let mod = loadMod(false)

// ── renderer ────────────────────────────────────────────────────────────────

const instances = new Map()

/** Call one function component with its own persistent hook storage. */
function callComponent(key, Component, props) {
	let inst = instances.get(key)
	if (inst === undefined) {
		inst = { hooks: [], memoDeps: {}, effectDeps: {}, cleanups: {}, slot: 0, counts: [], depth: 0 }
		instances.set(key, inst)
	}
	const prev = current
	current = inst
	inst.slot = 0
	try {
		return Component(props)
	} finally {
		inst.counts.push(inst.slot)
		current = prev
	}
}

/**
 * Descend the element tree, invoking every function component. Returns a tree
 * of host elements (type === string) with children already rendered, so the
 * assertions can look for real markup.
 */
function renderTree(node, keyPrefix) {
	if (node === null || node === undefined || typeof node === 'boolean') return null
	if (typeof node === 'string' || typeof node === 'number') return node
	if (Array.isArray(node)) return node.map((c, i) => renderTree(c, keyPrefix + '.' + i))
	if (!node.$$el) return node

	const { type, props } = node
	if (typeof type === 'function') {
		const name = type.displayName || type.name || 'anon'
		const child = callComponent(keyPrefix + '/' + name, type, props || {})
		return renderTree(child, keyPrefix + '/' + name)
	}
	return {
		$$el: true,
		type,
		props: Object.assign({}, props, { children: renderTree(props ? props.children : null, keyPrefix) }),
	}
}

/** Render the registered tab body (a thin wrapper) down to host elements. */
function renderView(View, props) {
	return renderTree({ $$el: true, type: View, props }, 'root')
}

/**
 * Run queued effects and let promise callbacks run. A fixed number of ticks is
 * used rather than "stop when nothing is pending": every api() stub resolves
 * immediately, and over-ticking is harmless, whereas stopping early silently
 * leaves state unapplied.
 */
async function flushEffects(ticks = 8) {
	for (let i = 0; i < ticks; i++) {
		const queue = effectQueue
		effectQueue = []
		for (const fn of queue) fn()
		await new Promise((r) => setImmediate(r))
	}
}

/**
 * Render a component to host elements and settle it: run effects, re-render
 * while state changed, repeat. Throws whatever the component throws — that is
 * the point of this file.
 */
async function mount(View, props) {
	let out = renderView(View, props)
	for (let i = 0; i < 40; i++) {
		await flushEffects()
		if (!dirty) break
		dirty = false
		out = renderView(View, props)
	}
	// A hook-count change between renders means a conditional hook.
	for (const [key, inst] of instances) {
		const counts = new Set(inst.counts)
		assert.equal(counts.size, 1,
			'hook count changed between renders for ' + key + ': ' + [...counts].join(' vs '))
	}
	return out
}

/**
 * Simulate unmounting: run every pending effect cleanup. Used to assert that a
 * component releases its global side effects (e.g. the body attribute that
 * hides the composer) when the user switches away.
 */
function cleanupEffects() {
	for (const inst of instances.values()) {
		for (const key of Object.keys(inst.cleanups)) {
			const fn = inst.cleanups[key]
			if (typeof fn === 'function') fn()
			delete inst.cleanups[key]
		}
		inst.effectDeps = {}
	}
}

/** Collect every element matching a predicate in a rendered host tree. */
function findAll(node, pred, out = []) {
	if (node === null || node === undefined || typeof node !== 'object') return out
	if (Array.isArray(node)) { for (const c of node) findAll(c, pred, out); return out }
	if (node.$$el) {
		if (pred(node)) out.push(node)
		findAll(node.props.children, pred, out)
	}
	return out
}

/** The 文档 tab body, as registered on the slot. */
function getView() {
	const registered = []
	const ctx = {
		effect(fn) { return fn() },
		inject() {},
		get(name) {
			if (name !== 'slots') return undefined
			return {
				inject: (k, cb) => cb(),
				register: (options, component) => { registered.push({ options, component }); return () => {} },
			}
		},
	}
	mod.apply(ctx)
	assert.equal(registered.length, 1)
	return registered[0].component
}

/** Reset per-test state; `withPrimitives` reloads the module accordingly. */
function resetHarness(withPrimitives = false) {
	mod = loadMod(withPrimitives)
	apiResponses.clear()
	fetchCalls = []
	markdownTextCalls.length = 0
	headChildren.length = 0
	documentListeners.length = 0
	instances.clear()
	dirty = false
	effectQueue = []
}

/** The click handler of a directory row, found by its label. */
function dirRow(out, dirName) {
	const label = findAll(out, (n) => n.props && n.props.className === 'mdv-dirname'
		&& typeof n.props.children === 'string' && n.props.children.includes(dirName))[0]
	assert.ok(label, 'no tree row for directory ' + dirName)
	const row = findAll(out, (n) => n.props && typeof n.props.className === 'string'
		&& n.props.className === 'mdv-row'
		&& Array.isArray(n.props.children)
		&& n.props.children.includes(label))[0]
	assert.ok(row, 'no clickable row for directory ' + dirName)
	return row
}

/** Expand a collapsed directory (the tree defaults to collapsed). */
async function expandDir(View, props, dirName) {
	const out = await mount(View, props)
	dirRow(out, dirName).props.onClick()
	await flushEffects()
	dirty = false
	return mount(View, props)
}

/**
 * Invoke the click handler of a tree row by file name, expanding ancestor
 * directories as needed. This is how a user reaches a non-markdown file
 * (auto-selection only ever picks markdown).
 */
async function clickRow(View, props, fileName, dirName) {
	let out = dirName ? await expandDir(View, props, dirName) : await mount(View, props)
	const row = findAll(out, (n) => n.props && typeof n.props.className === 'string'
		&& n.props.className.includes('mdv-filerow')
		&& typeof n.props.children === 'string'
		&& n.props.children.includes(fileName))[0]
	assert.ok(row, 'no tree row for ' + fileName)
	row.props.onClick()
	await flushEffects()
	dirty = false
	return mount(View, props)
}

const SESSION = 'sess-1'
const FILES = [
	{ path: 'README.md', name: 'README.md' },
	{ path: 'docs/guide.md', name: 'guide.md' },
	{ path: 'src/main.py', name: 'main.py' },
	{ path: 'assets/logo.png', name: 'logo.png' },
	{ path: 'data/table.csv', name: 'table.csv' },
	{ path: '收资资料/证据标注PDF/统计.pdf', name: '统计.pdf' },
]

console.log('MdVaultView renders without throwing')

await test('renders the empty state before the listing arrives', async () => {
	resetHarness()
	const View = getView()
	// No api response queued: the listing never resolves. The very first render
	// must still be safe — this is the state right after the tab is opened.
	const out = await mount(View, { sessionId: SESSION })
	assert.ok(out.$$el, 'expected an element')
	assert.equal(out.props['data-mdv-root'], '', 'root marker missing')
	// The toolbar (with the build id) must exist even before data arrives.
	assert.ok(JSON.stringify(out).includes(mod.__pure.version), 'toolbar missing')
})

await test('renders with a markdown document selected', async () => {
	resetHarness()
	apiResponses.set('list', { ok: true, files: FILES, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# Title\n\nsee [a](./x.pdf) and ![i](./i.png)\n' })
	const out = await mount(getView(), { sessionId: SESSION })
	assert.ok(out.$$el)
	assert.ok(JSON.stringify(out).includes('README.md'), 'the default selection should be README.md')
})

await test('renders a CODE document without throwing (the blank-page crash)', async () => {
	// Regression: `codeStats` was a `const` declared AFTER its use in the same
	// function body, so selecting any non-markdown text file threw
	// "Cannot access 'codeStats' before initialization" during render and the
	// whole tab went blank.
	resetHarness()
	const files = [{ path: 'src/main.py', name: 'main.py' }, { path: 'README.md', name: 'README.md' }]
	apiResponses.set('list', { ok: true, files, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: 'print("hello")\nprint("world")\n' })
	const View = getView()
	const out = await clickRow(View, { sessionId: SESSION }, 'main.py', 'src')
	assert.ok(out.$$el, 'expected an element')
	const text = JSON.stringify(out)
	// The code doc bar shows the path; this branch is what used to throw.
	assert.ok(text.includes('main.py'), 'the code document should be selected: ' + text.slice(0, 300))
	assert.ok(text.includes('编辑'), 'the edit affordance should be present')
})

await test('renders a large text document through the plain-text tier', async () => {
	resetHarness()
	const files = [{ path: 'huge.log', name: 'huge.log' }, { path: 'README.md', name: 'README.md' }]
	apiResponses.set('list', { ok: true, files, root: '/ws', truncated: false, maxDepth: 14 })
	// > HIGHLIGHT_MAX (200 KB) but < PLAIN_MAX (2 MB) -> plain <pre>, no highlight.
	apiResponses.set('read', { ok: true, text: 'x'.repeat(300 * 1024) })
	const View = getView()
	const out = await clickRow(View, { sessionId: SESSION }, 'huge.log')
	const pres = findAll(out, (n) => n.type === 'pre')
	assert.ok(pres.length > 0, 'expected a plain <pre> for a large file')
	assert.ok(JSON.stringify(out).includes('未高亮'), 'expected the plain-text notice')
})

await test('renders with the platform MarkdownText present', async () => {
	resetHarness(true)
	apiResponses.set('list', { ok: true, files: FILES, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# Hi\n\n[[wiki link]]\n' })
	const out = await mount(getView(), { sessionId: SESSION })
	assert.ok(out.$$el)
	assert.ok(markdownTextCalls.length > 0, 'MarkdownText should have rendered')
	// Wikilinks must be rewritten before the platform sees them.
	const last = markdownTextCalls[markdownTextCalls.length - 1]
	assert.ok(String(last.text).includes('dsh-mdvault.invalid'), 'wikilink not rewritten: ' + last.text)
	// The platform needs the copy labels, or it falls back to hardcoded text.
	assert.ok(last.labels && last.labels.code && last.labels.code.copyLabel, 'labels missing')
	// pathImages is how local images resolve.
	assert.equal(typeof last.pathImages.resolve, 'function', 'pathImages missing')
})

await test('a local screenshot referenced from a document resolves to the asset route', async () => {
	// This is the mechanism a README screenshot relies on. Unlike a remote
	// badge, a committed image is served by the plugin itself, so it renders
	// with no network access at all.
	resetHarness(true)
	const files = [
		{ path: 'README.md', name: 'README.md' },
		{ path: 'docs/screenshot.png', name: 'screenshot.png' },
	]
	apiResponses.set('list', { ok: true, files, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# doc\n\n![效果图](./docs/screenshot.png)\n' })
	await mount(getView(), { sessionId: SESSION })

	assert.ok(markdownTextCalls.length > 0, 'MarkdownText should have rendered')
	const { pathImages } = markdownTextCalls[markdownTextCalls.length - 1]
	assert.equal(typeof pathImages.resolve, 'function')

	const url = pathImages.resolve('./docs/screenshot.png')
	assert.ok(typeof url === 'string' && url.length > 0, 'expected a resolved url, got ' + String(url))
	assert.ok(url.includes('/mdvault/asset/'), 'must go through the plugin asset route: ' + String(url))
	assert.ok(url.includes(encodeURIComponent(SESSION)), 'must be session scoped: ' + String(url))
	assert.ok(url.includes(encodeURIComponent('docs/screenshot.png')), 'must address the committed path: ' + String(url))

	// Relative-to-the-document, not relative to the workspace root. The
	// resolver deliberately does not check existence — it builds the URL and a
	// missing file degrades to the platform's alt-text fallback.
	assert.equal(pathImages.resolve('screenshot.png'),
		'http://127.0.0.1:3080/mdvault/asset/' + encodeURIComponent(SESSION) + '/' + encodeURIComponent('screenshot.png'),
		'a bare name in a root document means a root-level file')

	// Remote images are left to the platform, which fetches them directly.
	assert.equal(pathImages.resolve('https://img.shields.io/npm/v/x.svg'), undefined,
		'a remote url must not be routed through the asset route')
})

await test('a bare image name resolves beside a nested document', async () => {
	resetHarness(true)
	const files = [
		{ path: 'README.md', name: 'README.md' },
		{ path: 'docs/guide.md', name: 'guide.md' },
		{ path: 'docs/screenshot.png', name: 'screenshot.png' },
	]
	apiResponses.set('list', { ok: true, files, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# guide\n\n![shot](screenshot.png)\n' })
	const View = getView()
	const out = await mount(View, { sessionId: SESSION })
	// Open docs/guide.md so the document's own directory is `docs`.
	const guide = findAll(out, (n) => n.props && typeof n.props.className === 'string'
		&& n.props.className === 'mdv-row'
		&& Array.isArray(n.props.children)
		&& n.props.children.some((c) => c && c.props && c.props.className === 'mdv-dirname'))[0]
	assert.ok(guide, 'no directory row to expand')
	guide.props.onClick()
	await flushEffects()
	dirty = false
	const expanded = await mount(View, { sessionId: SESSION })
	const row = findAll(expanded, (n) => n.props && typeof n.props.className === 'string'
		&& n.props.className.includes('mdv-filerow')
		&& typeof n.props.children === 'string' && n.props.children.includes('guide.md'))[0]
	assert.ok(row, 'no tree row for guide.md')
	row.props.onClick()
	await flushEffects()
	dirty = false
	await mount(View, { sessionId: SESSION })

	const { pathImages } = markdownTextCalls[markdownTextCalls.length - 1]
	assert.ok(String(pathImages.resolve('screenshot.png')).includes(encodeURIComponent('docs/screenshot.png')),
		'a bare name beside a nested document must resolve into that directory')
})

await test('renders the truncated badge when the host reports a capped listing', async () => {
	resetHarness()
	apiResponses.set('list', { ok: true, files: FILES, root: '/ws', truncated: true, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# x\n' })
	const out = await mount(getView(), { sessionId: SESSION })
	assert.ok(JSON.stringify(out).includes('已截断'), 'expected the truncation badge')
})

await test('renders the collapse-all control', async () => {
	resetHarness()
	apiResponses.set('list', { ok: true, files: FILES, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# x\n' })
	const out = await mount(getView(), { sessionId: SESSION })
	const labels = findAll(out, (n) => n.type === 'button')
		.map((b) => b.props.children).filter((c) => typeof c === 'string')
	assert.ok(labels.some((l) => l.includes('折叠')), 'collapse-all button missing: ' + labels.join(' | '))
	assert.ok(labels.some((l) => l.includes('刷新')), 'refresh button missing')
})

await test('the build id is rendered into the toolbar', async () => {
	resetHarness()
	apiResponses.set('list', { ok: true, files: FILES, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# x\n' })
	const out = await mount(getView(), { sessionId: SESSION })
	assert.ok(JSON.stringify(out).includes(mod.__pure.version), 'build id not shown')
})

await test('the tree renders collapsed: only the selected document path is open', async () => {
	resetHarness()
	apiResponses.set('list', { ok: true, files: FILES, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# x\n' })
	const out = await mount(getView(), { sessionId: SESSION })
	const carets = findAll(out, (n) => n.props && n.props.className === 'mdv-caret')
	const open = carets.filter((c) => c.props.children === '\u25BE').length
	assert.ok(open <= 1, 'too many directories open by default: ' + open + ' of ' + carets.length)
})

await test('a failing listing is surfaced instead of rendering blank', async () => {
	resetHarness()
	apiResponses.set('list', { ok: false, error: 'boom' })
	const out = await mount(getView(), { sessionId: SESSION })
	assert.ok(JSON.stringify(out).includes('boom'), 'the error should be surfaced')
})

await test('an asset viewer (PDF) renders without throwing', async () => {
	resetHarness(true)
	const files = [{ path: 'doc.pdf', name: 'doc.pdf' }, { path: 'README.md', name: 'README.md' }]
	apiResponses.set('list', { ok: true, files, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# x\n' })
	const View = getView()
	const out = await clickRow(View, { sessionId: SESSION }, 'doc.pdf')
	assert.ok(out.$$el)
	assert.ok(JSON.stringify(out).includes('doc.pdf'), 'the pdf should be the selected asset')
})

await test('the composer is hidden while the view is mounted, and restored on unmount', async () => {
	resetHarness()
	apiResponses.set('list', { ok: true, files: FILES, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# x\n' })
	const View = getView()
	const props = { sessionId: SESSION }
	const out = await mount(View, props)
	// The effect must have claimed the body attribute for the CSS rule.
	assert.equal(document.body.attrs['data-mdvault-hide-composer'], '',
		'the composer-hiding body attribute was not set')

	// The toolbar toggle must be able to bring it back.
	const toggle = findAll(out, (n) => n.type === 'button'
		&& typeof n.props.children === 'string' && n.props.children.includes('输入框'))[0]
	assert.ok(toggle, 'no composer toggle button in the toolbar')
	toggle.props.onClick()
	await flushEffects()
	dirty = false
	const shown = await mount(View, props)
	assert.ok(!('data-mdvault-hide-composer' in document.body.attrs),
		'toggling should release the body attribute so the composer reappears')

	// Toggle back off, then unmount and confirm cleanup.
	const toggle2 = findAll(shown, (n) => n.type === 'button'
		&& typeof n.props.children === 'string' && n.props.children.includes('输入框'))[0]
	toggle2.props.onClick()
	await flushEffects()
	dirty = false
	await mount(View, props)
	assert.equal(document.body.attrs['data-mdvault-hide-composer'], '')

	// Simulate the view unmounting (switching back to 对话).
	cleanupEffects()
	assert.ok(!('data-mdvault-hide-composer' in document.body.attrs),
		'the attribute must be removed when the view unmounts, or the composer would stay hidden forever')
})

await test('a failing READ is surfaced instead of rendering blank', async () => {
	resetHarness()
	apiResponses.set('list', { ok: true, files: FILES, root: '/ws', truncated: false, maxDepth: 14 })
	// The listing succeeds but the document itself cannot be read.
	apiResponses.set('read', { ok: false, error: '文件过大（20MB），超过 6MB 的在线编辑上限' })
	const out = await mount(getView(), { sessionId: SESSION })
	assert.ok(JSON.stringify(out).includes('超过 6MB'), 'the read error should be surfaced')
})

await test('selecting an asset takes over the pane (no stale document)', async () => {
	resetHarness(true)
	// Both files at the root, so this tests the pane switch only — tree
	// navigation is covered elsewhere.
	const files = [{ path: 'README.md', name: 'README.md' }, { path: 'doc.pdf', name: 'doc.pdf' }]
	apiResponses.set('list', { ok: true, files, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# first\n' })
	const View = getView()
	const props = { sessionId: SESSION }

	const out1 = await mount(View, props)
	assert.ok(markdownTextCalls.length > 0, 'the markdown document should render first')
	assert.ok(String(markdownTextCalls[markdownTextCalls.length - 1].text).includes('first'))

	const pdfRow = findAll(out1, (n) => n.props && typeof n.props.className === 'string'
		&& n.props.className.includes('mdv-filerow')
		&& typeof n.props.children === 'string' && n.props.children.includes('doc.pdf'))[0]
	assert.ok(pdfRow, 'no tree row for doc.pdf')
	pdfRow.props.onClick()
	await flushEffects()
	dirty = false
	const out2 = await mount(View, props)
	const text2 = JSON.stringify(out2)
	assert.ok(text2.includes('doc.pdf'), 'the pdf should now own the pane')
	assert.ok(!text2.includes('正在读取'), 'the pane should not still be loading a text document')
})

await test('clicking a ROOT file while a subdirectory document is open opens the ROOT file', async () => {
	// Regression: tree clicks went through link resolution, which resolves
	// relative to the OPEN DOCUMENT. With a document inside sub/ open, clicking
	// a root-level asset resolved to `sub/<name>` and 404ed. Workspaces that
	// keep a README at the root hid this, because there the base directory is
	// '' and both resolutions agree.
	resetHarness(true)
	const files = [
		{ path: 'README.md', name: 'README.md' },
		{ path: 'sub/notes.md', name: 'notes.md' },
		{ path: '测试图片.jpg', name: '测试图片.jpg' },
	]
	apiResponses.set('list', { ok: true, files, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# from sub\n' })
	const View = getView()
	const props = { sessionId: SESSION }

	// Open the nested document, so the "current document" base becomes `sub`.
	const out1 = await clickRow(View, props, 'notes.md', 'sub')
	const img = findAll(out1, (n) => n.props && typeof n.props.className === 'string'
		&& n.props.className.includes('mdv-filerow')
		&& typeof n.props.children === 'string' && n.props.children.includes('测试图片.jpg'))[0]
	assert.ok(img, 'no tree row for the root image')

	img.props.onClick()
	await flushEffects()
	dirty = false
	const out2 = await mount(View, props)
	const text = JSON.stringify(out2)
	assert.ok(text.includes('测试图片.jpg'), 'the image should own the pane')
	assert.ok(!text.includes('sub%2F') && !text.includes('sub/测试图片.jpg'),
		'the asset url must NOT resolve into the open document\'s directory: ' + text.slice(0, 400))
	assert.ok(text.includes(encodeURIComponent('测试图片.jpg')), 'expected the root-relative asset url')
})

await test('the tree column renders a draggable split handle', async () => {
	resetHarness()
	apiResponses.set('list', { ok: true, files: FILES, root: '/ws', truncated: false, maxDepth: 14 })
	apiResponses.set('read', { ok: true, text: '# x\n' })
	const out = await mount(getView(), { sessionId: SESSION })
	const handle = findAll(out, (n) => n.props && typeof n.props.className === 'string'
		&& n.props.className.includes('mdv-split'))[0]
	assert.ok(handle, 'no split handle rendered')
	for (const k of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onDoubleClick', 'onKeyDown']) {
		assert.equal(typeof handle.props[k], 'function', 'handle is missing ' + k)
	}
	assert.equal(handle.props.role, 'separator')
	assert.equal(handle.props.tabIndex, 0, 'the handle must be keyboard reachable')
	assert.equal(typeof handle.props['aria-valuenow'], 'number')

	// The tree column must carry the width the handle drives.
	const side = findAll(out, (n) => n.props && n.props.className === 'mdv-side')[0]
	assert.ok(side, 'no tree column rendered')
	assert.equal(typeof side.props.style.width, 'number', 'the tree column has no width from the split')
})

console.log('')
console.log(passed + ' assertions passed' + (failures.length ? ', ' + failures.length + ' FAILED' : ''))
if (failures.length) console.log('failed: ' + failures.join(' | '))
