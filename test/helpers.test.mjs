/**
 * Offline tests for dsh-mdvault's pure client helpers.
 *
 * The browser half is a plain CommonJS module registered through
 * `window.__ModuleLoader__.load`. This harness stubs that global plus
 * `require('react')`, captures the factory, and exercises the exported
 * `__pure` helpers — so the link-rewriting and frontmatter logic is tested
 * against the real shipped code rather than a copy.
 *
 * Run: node test/helpers.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let registration = null
const headChildren = []
/** document-level listeners the plugin installs (the link interceptor). */
const documentListeners = []
const sandbox = {
	window: {
		__ModuleLoader__: {
			load(spec) { registration = spec },
		},
		location: { origin: 'http://127.0.0.1:3080' },
	},
	document: {
		head: { appendChild(el) { headChildren.push(el) } },
		// Model the id registry: insertStyles dedupes through it, so returning
		// null unconditionally would hide whether dedupe actually works.
		getElementById(id) { return headChildren.find((el) => el.id === id) ?? null },
		createElement(tag) {
			return {
				tagName: tag, id: '', textContent: '', className: '',
				children: [], classList: [],
				setAttribute() {}, removeAttribute() {}, getAttribute() { return null },
				addEventListener() {}, removeEventListener() {}, remove() {},
				appendChild(c) { this.children.push(c) },
				replaceChildren() {}, querySelector() { return null },
				querySelectorAll() { return [] },
			}
		},
		body: { hasAttribute() { return false } },
		// The plugin registers its internal-link interceptor on the document in
		// the CAPTURE phase; record it so tests can assert it was installed.
		listeners: documentListeners,
		addEventListener(type, fn, capture) { documentListeners.push({ type, fn, capture }) },
		removeEventListener(type, fn, capture) {
			const i = documentListeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture)
			if (i >= 0) documentListeners.splice(i, 1)
		},
	},
	// Browser globals the module legitimately uses. A vm context does NOT
	// inherit them, and parseUrl() would otherwise swallow the ReferenceError
	// and report every URL as "not ours" — silently passing broken tests.
	URL,
	URLSearchParams,
	AbortController,
	console,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

assert.ok(registration !== null, 'client.js must register with __ModuleLoader__')
assert.equal(registration.id, 'dsh-mdvault')

// Minimal React stand-in: the pure helpers never touch it, but the module body
// builds the component tree at call time only, so this is enough to load.
const reactStub = {
	createElement() { return null },
	useState(v) { return [v, () => {}] },
	useEffect() {},
	useMemo(fn) { return fn() },
	useRef(v) { return { current: v } },
	useCallback(fn) { return fn },
	memo(fn) { return fn },
}

const mod = registration.factory((spec) => {
	if (spec === 'react') return reactStub
	throw new Error('unexpected require: ' + spec)
})

const pure = mod.__pure
assert.ok(pure, 'the module must export __pure helpers')

let passed = 0
function test(name, fn) {
	try {
		fn()
		passed += 1
		console.log('  ok  ' + name)
	} catch (err) {
		console.error('FAIL  ' + name)
		console.error('      ' + (err && err.message))
		process.exitCode = 1
	}
}

const { rewriteInternalLinks, stripFrontmatter, toRelPath, fenceFor, langForPath, isTextDoc, decodeTarget, hasMermaidFence, sanitizeSvg, isStrippedSvgElement, isStrippedSvgAttr, resolveRelPath, resolveOpenTarget, findByPathIn, formatBytes, isDirOpen, classifyInternalLink, anchorFromEvent, WIKI_PREFIX, REL_PREFIX } = pure

console.log('rewriteInternalLinks')

test('plain wikilink becomes an intercepted link with the target as label', () => {
	const out = rewriteInternalLinks('见 [[笔记]] 了解详情')
	assert.ok(out.includes('[' + '笔记' + '](' + WIKI_PREFIX), out)
	assert.equal(decodeTarget(out.slice(out.indexOf(WIKI_PREFIX) + WIKI_PREFIX.length, out.indexOf(')'))), '笔记')
})

test('wikilink alias keeps the label and encodes the target', () => {
	const out = rewriteInternalLinks('[[folder/note.md|显示名]]')
	assert.ok(out.includes('[显示名]('), out)
	assert.ok(out.includes(encodeURIComponent('folder/note.md')), out)
})

test('wikilink with a #page fragment keeps the fragment in the target', () => {
	const out = rewriteInternalLinks('[[手册.pdf#page=17|第17页]]')
	const encoded = out.slice(out.indexOf(WIKI_PREFIX) + WIKI_PREFIX.length, out.indexOf(')'))
	assert.equal(decodeTarget(encoded), '手册.pdf#page=17')
})

test('relative markdown link is rewritten to the document-relative prefix', () => {
	const out = rewriteInternalLinks('[other](./sub/other.md)')
	assert.ok(out.includes(REL_PREFIX + encodeURIComponent('./sub/other.md')), out)
})

test('a wikilink and a relative link get different prefixes', () => {
	// The path segment records which resolution rule applies: [[x]] is
	// vault-root-relative in Obsidian, [x](./y.md) is document-relative.
	const wiki = rewriteInternalLinks('[[note]]')
	const rel = rewriteInternalLinks('[note](./note.md)')
	assert.ok(wiki.includes(WIKI_PREFIX), wiki)
	assert.ok(rel.includes(REL_PREFIX), rel)
	assert.ok(!rel.includes(WIKI_PREFIX), rel)
})

test('remote http(s) links are left alone', () => {
	const src = '[site](https://example.com/a.md)'
	assert.equal(rewriteInternalLinks(src), src)
})

test('anchor-only links are left alone', () => {
	const src = '[top](#section)'
	assert.equal(rewriteInternalLinks(src), src)
})

test('image syntax is never converted to an internal link', () => {
	const src = '![alt](./pic.png)'
	const out = rewriteInternalLinks(src)
	assert.ok(out.startsWith('!['), out)
	assert.ok(!out.includes(WIKI_PREFIX), out)
})

test('link syntax inside a fenced code block is not rewritten', () => {
	const src = '```\n[[not-a-link]]\n[x](./y.md)\n```'
	assert.equal(rewriteInternalLinks(src), src)
})

test('link syntax inside an inline code span is not rewritten', () => {
	const src = 'use `[[wiki]]` syntax'
	assert.equal(rewriteInternalLinks(src), src)
})

test('fenced code is restored byte-for-byte', () => {
	const src = 'before\n\n```js\nconst a = `tpl ${x}`\n```\n\nafter [[real]]'
	const out = rewriteInternalLinks(src)
	assert.ok(out.includes('const a = `tpl ${x}`'), out)
	assert.ok(out.includes(WIKI_PREFIX), out)
})

test('a label containing parentheses cannot break out of the produced link', () => {
	const out = rewriteInternalLinks('[[a(b|c(d]]')
	// The target is percent-encoded, so no raw "(" reaches the URL.
	const encoded = out.slice(out.indexOf(WIKI_PREFIX) + WIKI_PREFIX.length, out.indexOf(')'))
	assert.equal(decodeTarget(encoded), 'a(b')
	assert.ok(out.includes('%28'), out)
})

test('a target containing parentheses stays percent-encoded in the URL', () => {
	const out = rewriteInternalLinks('[x](./a(1).md)')
	const encoded = out.slice(out.indexOf(REL_PREFIX) + REL_PREFIX.length, out.indexOf(')'))
	assert.equal(decodeTarget(encoded), './a(1).md')
	assert.ok(!/[()]/.test(encoded), out)
})

console.log('stripFrontmatter')

test('a closed leading frontmatter block is removed', () => {
	assert.equal(stripFrontmatter('---\ntitle: x\n---\n# Body'), '# Body')
})

test('unclosed frontmatter is left untouched', () => {
	const src = '---\ntitle: x\n# Body'
	assert.equal(stripFrontmatter(src), src)
})

test('a rule that is not on the first line is left untouched', () => {
	const src = 'text\n\n---\n\nmore'
	assert.equal(stripFrontmatter(src), src)
})

test('a document with no newline is left untouched', () => {
	assert.equal(stripFrontmatter('---'), '---')
})

test('CRLF frontmatter is recognised', () => {
	assert.equal(stripFrontmatter('---\r\ntitle: x\r\n---\r\n# Body'), '# Body')
})

console.log('toRelPath')

test('a bare filename resolves against the current directory', () => {
	assert.equal(toRelPath('pic.png', 'docs/note.md'), 'docs/pic.png')
})

test('a leading slash resolves from the workspace root', () => {
	assert.equal(toRelPath('/assets/pic.png', 'docs/note.md'), 'assets/pic.png')
})

test('a parent traversal is clamped at the workspace root', () => {
	assert.equal(toRelPath('../pic.png', 'docs/note.md'), 'pic.png')
})

test('an over-deep traversal still cannot escape the root', () => {
	// Traversal above the root is clamped rather than rejected, so the result
	// stays a clean relative path that the host resolves under the workspace.
	const out = toRelPath('../../../etc/passwd', 'note.md')
	assert.equal(out, 'etc/passwd')
	assert.ok(!out.split('/').includes('..'), 'no .. segment may survive')
})

test('no input can produce a path escaping the root', () => {
	for (const evil of ['../../a', '/../a', './../../b', 'a/../../../../b', '..', '../']) {
		const out = toRelPath(evil, 'deep/dir/note.md')
		if (out === null) continue
		assert.ok(!out.split('/').includes('..'), evil + ' produced ' + out)
		assert.ok(!out.startsWith('/'), evil + ' produced ' + out)
		assert.ok(!/^[a-zA-Z]:/.test(out), evil + ' produced ' + out)
	}
})

test('a dot-prefixed segment is refused (host safeRel rejects it)', () => {
	assert.equal(toRelPath('.git/config', 'note.md'), null)
})

test('a query/fragment is stripped from the destination', () => {
	assert.equal(toRelPath('pic.png?v=2', 'note.md'), 'pic.png')
})

test('percent-encoded segments are decoded', () => {
	assert.equal(toRelPath('%E4%B8%AD%E6%96%87.png', 'note.md'), '中文.png')
})

test('an empty destination returns null', () => {
	assert.equal(toRelPath('', 'note.md'), null)
})

console.log('fenceFor / langForPath / isTextDoc')

test('the fence outgrows any backtick run inside the content', () => {
	assert.equal(fenceFor('a ``` b'), '````')
	assert.equal(fenceFor('plain'), '```')
})

test('language hints map common extensions', () => {
	assert.equal(langForPath('a/b.ts'), 'typescript')
	assert.equal(langForPath('x/y.py'), 'python')
	assert.equal(langForPath('Makefile'), 'makefile')
	assert.equal(langForPath('q.unknown'), '')
})

test('spreadsheets are not text documents (they use the sheet viewer)', () => {
	assert.equal(isTextDoc('data.csv'), false)
	assert.equal(isTextDoc('data.xlsx'), false)
	assert.equal(isTextDoc('note.md'), true)
	assert.equal(isTextDoc('main.py'), true)
	assert.equal(isTextDoc('page.html'), false)
})

console.log('hasMermaidFence')

test('a fenced mermaid block is detected', () => {
	assert.equal(hasMermaidFence('text\n\n```mermaid\ngraph TD; A-->B;\n```\n'), true)
})

test('a tilde fence works too', () => {
	assert.equal(hasMermaidFence('~~~mermaid\ngraph TD; A-->B;\n~~~'), true)
})

test('the mermaid{...} info form is detected', () => {
	assert.equal(hasMermaidFence('```mermaid{theme=dark}\ngraph TD; A-->B;\n```'), true)
})

test('another language is not detected', () => {
	assert.equal(hasMermaidFence('```js\nconst a = 1\n```'), false)
})

test('the word mermaid in prose does not trigger a load', () => {
	assert.equal(hasMermaidFence('we use mermaid for diagrams'), false)
})

test('an unterminated mermaid fence does not trigger a load', () => {
	assert.equal(hasMermaidFence('```mermaid\ngraph TD; A-->B;'), false)
})

test('a shorter closing fence does not close the block', () => {
	assert.equal(hasMermaidFence('````mermaid\ngraph TD; A-->B;\n```\n````'), true)
})

test('an inline code span mentioning mermaid does not trigger a load', () => {
	assert.equal(hasMermaidFence('run `mermaid` to render'), false)
})

console.log('sanitizeSvg predicates (the security decisions, DOM-free)')

test('script / foreignObject / iframe elements are stripped', () => {
	for (const name of ['script', 'foreignObject', 'iframe', 'object', 'embed', 'img', 'form', 'base'])
		assert.equal(isStrippedSvgElement(name), true, name)
})

test('element matching is case-insensitive', () => {
	for (const name of ['SCRIPT', 'sCrIpT', 'ForeignObject', 'FOREIGNOBJECT'])
		assert.equal(isStrippedSvgElement(name), true, name)
})

test('ordinary svg elements are kept', () => {
	for (const name of ['svg', 'g', 'rect', 'path', 'text', 'tspan', 'defs', 'marker', 'style'])
		assert.equal(isStrippedSvgElement(name), false, name)
})

test('event handler attributes are stripped, case-insensitively', () => {
	for (const name of ['onload', 'onerror', 'ONCLICK', 'oNloAd', 'onmouseover'])
		assert.equal(isStrippedSvgAttr(name), true, name)
})

test('vue-style @ attributes are stripped', () => {
	assert.equal(isStrippedSvgAttr('@click'), true)
})

test('every href form is stripped', () => {
	for (const name of ['href', 'HREF', 'xlink:href', 'XLINK:HREF'])
		assert.equal(isStrippedSvgAttr(name), true, name)
})

test('ordinary svg presentation attributes are kept', () => {
	for (const name of ['d', 'fill', 'stroke', 'width', 'height', 'transform', 'class', 'id', 'viewBox', 'xmlns'])
		assert.equal(isStrippedSvgAttr(name), false, name)
})

// A DOM is required for the parse/serialize path; the predicates above cover
// the security decisions, and the full path runs in the browser.
if (typeof globalThis.DOMParser === 'undefined') {
	console.log('sanitizeSvg (full path)')
	console.log('  --  DOMParser unavailable in node; predicates covered above')
} else {
	console.log('sanitizeSvg (full path)')
	test('a plain svg survives sanitization', () => {
		const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')
		assert.ok(out.includes('<rect'), out)
	})
	test('malformed svg yields the empty string', () => {
		assert.equal(sanitizeSvg('<svg><unclosed>'), '')
	})
	test('a non-svg root is rejected', () => {
		assert.equal(sanitizeSvg('<html><body>x</body></html>'), '')
	})
}

console.log('apply() against a fake client context')

/**
 * Fake client context. `services` are what `ctx.get` answers; the scoped
 * `ctx.inject(deps, cb)` form runs its callback only when every named service
 * is present, mirroring Cordis.
 */
function makeCtx(services) {
	const seen = { registered: [], slotInjects: [], scoped: [], effects: [] }
	const slots = {
		inject(key, cb) { seen.slotInjects.push(key); return cb() },
		register(options, component) {
			seen.registered.push({ options, component })
			return () => {}
		},
	}
	const ctx = {
		effect(fn, label) { seen.effects.push(label); return fn() },
		get(name) { return name === 'slots' ? slots : services[name] },
		inject(deps, cb) {
			seen.scoped.push([...deps])
			if (deps.every((d) => services[d] !== undefined)) cb(ctx)
			return () => {}
		},
	}
	return { ctx, seen }
}

function emptySeen() {
	return { registered: [], slotInjects: [], scoped: [], effects: [] }
}

await test('exports name / inject / apply the way a DSH client plugin must', () => {
	// The missing `inject` export was the actual bug: without it the plugin is
	// activated concurrently with the renderer, loses the race for the `slots`
	// service, and silently registers nothing while still reporting as active.
	assert.equal(mod.name, 'dsh-mdvault')
	assert.deepEqual([...mod.inject], ['slots'])
	assert.equal(typeof mod.apply, 'function')
})

await test('apply registers the 文档 tab on the conversation.view slot', () => {
	const { ctx, seen } = makeCtx({})
	mod.apply(ctx)
	assert.deepEqual(seen.slotInjects, ['conversation.view'])
	assert.equal(seen.registered.length, 1)
	assert.equal(seen.registered[0].options.name, 'conversation.view')
	assert.equal(seen.registered[0].options.id, 'mdvault')
	assert.equal(seen.registered[0].options.label, '文档')
	assert.equal(typeof seen.registered[0].component, 'function')
})

await test('the registration runs inside a ctx.effect so the fiber owns it', () => {
	const { ctx, seen } = makeCtx({})
	mod.apply(ctx)
	assert.ok(seen.effects.some((l) => typeof l === 'string' && l.includes('mdvault')), seen.effects.join(','))
})

await test('apply installs the internal-link interceptor in the CAPTURE phase', () => {
	// Capture phase is what lets preventDefault() beat the platform's
	// target="_blank" — the reason a click used to open a new browser tab.
	const before = documentListeners.length
	const { ctx } = makeCtx({})
	mod.apply(ctx)
	const added = documentListeners.slice(before).filter((l) => l.type === 'click')
	assert.equal(added.length, 1, 'expected exactly one click listener per apply')
	assert.equal(added[0].capture, true, 'must be registered with capture=true')
})

await test('the interceptor suppresses navigation even with no owner mounted', () => {
	const { ctx } = makeCtx({})
	mod.apply(ctx)
	const listener = documentListeners.filter((l) => l.type === 'click').pop()

	const root = { nodeType: 1, tagName: 'DIV', closest: (sel) => (sel === '[data-mdv-root]' ? root : null) }
	const anchor = {
		nodeType: 1, tagName: 'A',
		hasAttribute: () => true,
		getAttribute: () => REL_PREFIX + encodeURIComponent('收资资料/a.pdf#page=1'),
		href: REL_PREFIX + encodeURIComponent('收资资料/a.pdf#page=1'),
		closest: (sel) => (sel === '[data-mdv-root]' ? root : null),
	}
	let prevented = false
	listener.fn({
		button: 0,
		defaultPrevented: false,
		composedPath: () => [anchor, root],
		preventDefault() { prevented = true },
		stopPropagation() {},
	})
	assert.equal(prevented, true, 'a recognized internal link must never navigate')
})

await test('the interceptor leaves external links alone', () => {
	const { ctx } = makeCtx({})
	mod.apply(ctx)
	const listener = documentListeners.filter((l) => l.type === 'click').pop()
	const anchor = {
		nodeType: 1, tagName: 'A', hasAttribute: () => true,
		getAttribute: () => 'https://example.com/x', href: 'https://example.com/x',
	}
	let prevented = false
	listener.fn({
		button: 0, defaultPrevented: false,
		composedPath: () => [anchor],
		preventDefault() { prevented = true },
		stopPropagation() {},
	})
	assert.equal(prevented, false, 'an external link must keep its default behavior')
})

await test('apply still works when ctx.get is unavailable (uses ctx.slots)', () => {
	const { ctx, seen } = makeCtx({})
	delete ctx.get
	ctx.slots = {
		inject(key, cb) { seen.slotInjects.push(key); return cb() },
		register(o, c) { seen.registered.push({ options: o, component: c }); return () => {} },
	}
	mod.apply(ctx)
	assert.equal(seen.registered.length, 1)
})

await test('apply warns instead of silently doing nothing when slots is absent', () => {
	// Regression guard: the old code returned silently here, which is how the
	// tab could vanish with no diagnostic anywhere.
	const warnings = []
	const originalWarn = console.warn
	console.warn = (...args) => { warnings.push(args.join(' ')) }
	try {
		mod.apply({ effect(fn) { return fn() }, inject() {}, get() { return undefined } })
	} finally {
		console.warn = originalWarn
	}
	assert.equal(warnings.length, 1)
	assert.ok(warnings[0].includes('slots'), warnings[0])
})

await test('apply injects its stylesheet exactly once, across repeated applies', () => {
	// Several apply() calls have already run above; insertStyles must dedupe on
	// its element id rather than appending a new <style> every activation
	// (Cordis re-applies a plugin on every hot reload).
	const { ctx } = makeCtx({})
	mod.apply(ctx)
	mod.apply(ctx)
	assert.equal(headChildren.length, 1, 'expected exactly one injected style element')
	assert.ok(headChildren[0].textContent.includes('.mdv-'), 'stylesheet body missing')
	assert.ok(headChildren[0].textContent.includes('.mdv-mermaid'), 'mermaid styles missing')
})

await test('betterSidebar is awaited scoped, never declared a hard dependency', () => {
	// Declaring it in `inject` would leave the plugin permanently pending on a
	// deployment without dsh-better-sidebar.
	assert.ok(!mod.inject.includes('betterSidebar'), 'must not be a hard dependency')
	const { ctx, seen } = makeCtx({ betterSidebar: undefined })
	mod.apply(ctx)
	assert.deepEqual(seen.scoped, [['betterSidebar']], 'must be awaited through ctx.inject')
	assert.equal(seen.registered.length, 1, 'the tab must register without better-sidebar present')
})

await test('the better-sidebar integration mounts when the service is present', () => {
	const viewers = []
	const tabs = []
	const { ctx } = makeCtx({
		betterSidebar: {
			registerFileViewer(d) { viewers.push(d); return () => {} },
			registerTab(d) { tabs.push(d); return () => {} },
			openTab() {},
		},
	})
	mod.apply(ctx)
	assert.equal(viewers.length, 1)
	assert.equal(viewers[0].id, 'mdvault-markdown')
	assert.deepEqual([...viewers[0].exts], ['md', 'markdown'])
	assert.equal(tabs.length, 1)
	assert.equal(tabs[0].id, 'mdvault-pdf')
})

console.log('resolveOpenTarget — the link-opening rules')

// A listing deliberately NOT containing the linked files, reproducing the
// condition that broke links: the target is outside the tree listing.
const listing = [{ path: 'notes/readme.md', name: 'readme.md' }]
const doc = 'projects/alpha/report.md'

await test('a pdf linked from a document resolves beside that document', () => {
	// '../' pops the document's own directory: the base is projects/alpha, so
	// the result is projects/assets/manual.pdf — but crucially it is resolved
	// FROM the document, not from the workspace root.
	const out = resolveOpenTarget('../assets/manual.pdf', doc, 'rel', listing)
	assert.equal(out.kind, 'pdf')
	assert.equal(out.rel, 'projects/assets/manual.pdf')
})

await test('regression: a deep link no longer resolves to the workspace root', () => {
	// The original bug resolved './x.pdf' as root-relative when the tree
	// listing missed, producing 'x.pdf' instead of 'projects/alpha/x.pdf'.
	const out = resolveOpenTarget('./x.pdf', 'projects/alpha/report.md', 'rel', [
		{ path: 'unrelated.md', name: 'unrelated.md' },
	])
	assert.equal(out.rel, 'projects/alpha/x.pdf')
	assert.notEqual(out.rel, 'x.pdf')
})

await test('a png linked from a document resolves beside that document', () => {
	const out = resolveOpenTarget('./img/diagram.png', doc, 'rel', listing)
	assert.equal(out.kind, 'image')
	assert.equal(out.rel, 'projects/alpha/img/diagram.png')
})

await test('a bare sibling filename resolves beside the document', () => {
	const out = resolveOpenTarget('figure.png', doc, 'rel', listing)
	assert.equal(out.rel, 'projects/alpha/figure.png')
})

await test('resolution does not require the file to be in the listing', () => {
	// The old code consulted the tree first; a miss changed the base directory.
	const out = resolveOpenTarget('./deep/hidden/thing.pdf', doc, 'rel', [])
	assert.equal(out.rel, 'projects/alpha/deep/hidden/thing.pdf')
})

await test('a leading slash is still workspace-root absolute', () => {
	const out = resolveOpenTarget('/shared/manual.pdf', doc, 'rel', listing)
	assert.equal(out.rel, 'shared/manual.pdf')
})

await test('a pdf page fragment is preserved', () => {
	const out = resolveOpenTarget('./manual.pdf#page=17', doc, 'rel', listing)
	assert.equal(out.kind, 'pdf')
	assert.equal(out.rel, 'projects/alpha/manual.pdf')
	assert.equal(out.frag, 'page=17')
})

await test('each extension maps to its viewer kind', () => {
	const cases = [
		['a.png', 'image'], ['a.jpg', 'image'], ['a.svg', 'image'],
		['a.pdf', 'pdf'], ['a.csv', 'sheet'], ['a.xlsx', 'sheet'],
		['a.html', 'html'], ['a.py', 'text'], ['a.json', 'text'],
		['a.md', 'note'], ['a.markdown', 'note'],
	]
	for (const [name, kind] of cases) {
		const out = resolveOpenTarget(name, doc, 'rel', listing)
		assert.equal(out.kind, kind, name)
	}
})

await test('an exotic extension falls back to download', () => {
	const out = resolveOpenTarget('./archive.zip', doc, 'rel', listing)
	assert.equal(out.kind, 'file')
})

await test('a relative markdown link resolves beside the document', () => {
	const out = resolveOpenTarget('./sibling.md', doc, 'rel', listing)
	assert.equal(out.kind, 'note')
	assert.equal(out.rel, 'projects/alpha/sibling.md')
})

await test('a wikilink resolves from the vault root', () => {
	const list = [{ path: 'notes/idea.md', name: 'idea.md' }]
	const out = resolveOpenTarget('notes/idea', doc, 'wiki', list)
	assert.equal(out.kind, 'note')
	assert.equal(out.rel, 'notes/idea.md')
})

await test('a bare wikilink falls back to a basename match anywhere', () => {
	const list = [{ path: 'deep/nested/target.md', name: 'target.md' }]
	const out = resolveOpenTarget('target', doc, 'wiki', list)
	assert.equal(out.kind, 'note')
	assert.equal(out.rel, 'deep/nested/target.md')
})

await test('a relative markdown link wins over a basename scan', () => {
	const list = [
		{ path: 'elsewhere/sibling.md', name: 'sibling.md' },
		{ path: 'projects/alpha/sibling.md', name: 'sibling.md' },
	]
	const out = resolveOpenTarget('./sibling.md', doc, 'rel', list)
	assert.equal(out.rel, 'projects/alpha/sibling.md')
})

await test('an extension-less non-note stays a text file', () => {
	const out = resolveOpenTarget('./Dockerfile', doc, 'rel', [])
	assert.equal(out.kind, 'text')
})

await test('escaping the workspace root is clamped, never escaped', () => {
	const out = resolveOpenTarget('../../../../../../etc/passwd', doc, 'rel', [])
	assert.equal(out.rel, 'etc/passwd')
	assert.ok(!out.rel.includes('..'))
})

await test('a dot-prefixed segment is refused', () => {
	assert.equal(resolveOpenTarget('./.git/config', doc, 'rel', []), null)
})

await test('an empty or fragment-only target is refused', () => {
	assert.equal(resolveOpenTarget('', doc, 'rel', []), null)
	assert.equal(resolveOpenTarget('#section', doc, 'rel', []), null)
	assert.equal(resolveOpenTarget(null, doc, 'rel', []), null)
})

console.log('resolveRelPath')

await test('a relative path joins the base directory', () => {
	assert.equal(resolveRelPath('a/b.png', 'x/y'), 'x/y/a/b.png')
})

await test('a leading slash ignores the base', () => {
	assert.equal(resolveRelPath('/a/b.png', 'x/y'), 'a/b.png')
})

await test('parent segments pop and clamp at the root', () => {
	assert.equal(resolveRelPath('../a.png', 'x/y'), 'x/a.png')
	assert.equal(resolveRelPath('../../a.png', 'x'), 'a.png')
	assert.equal(resolveRelPath('../../../a.png', ''), 'a.png')
})

await test('query and fragment are stripped', () => {
	assert.equal(resolveRelPath('a.png?v=1#x', ''), 'a.png')
})

console.log('findByPathIn / formatBytes')

await test('exact path match wins, then extension-less and family aliases', () => {
	const list = [{ path: 'a/b.md', name: 'b.md' }]
	assert.equal(findByPathIn(list, 'a/b.md').path, 'a/b.md', 'exact')
	assert.equal(findByPathIn(list, 'a/b').path, 'a/b.md', 'extension-less appends .md')
	assert.equal(findByPathIn(list, 'a/b.markdown').path, 'a/b.md', 'markdown family swaps')
	assert.equal(findByPathIn(list, 'a/b.mdx').path, 'a/b.md', 'mdx is the same family')
	assert.equal(findByPathIn(list, 'nope'), null)
})

await test('a non-markdown request never matches a markdown file', () => {
	const list = [{ path: 'a/b.md', name: 'b.md' }]
	assert.equal(findByPathIn(list, 'a/b.png'), null)
	assert.equal(findByPathIn(list, 'a/b.md.bak'), null)
})

await test('byte sizes format readably', () => {
	assert.equal(formatBytes(512), '512 B')
	assert.equal(formatBytes(2048), '2.0 KB')
	assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB')
})

console.log('isDirOpen — the tree expansion rule')

await test('directories are collapsed by default', () => {
	// The old rule (`!collapsed[path]`) opened EVERY directory on first paint,
	// rendering one DOM row per file in the workspace.
	assert.equal(isDirOpen('docs', {}, ''), false)
	assert.equal(isDirOpen('docs', {}, null), false)
})

await test('the ancestors of the selected file open so it is visible', () => {
	const sel = 'docs/2026/alpha/report.md'
	assert.equal(isDirOpen('docs', {}, sel), true)
	assert.equal(isDirOpen('docs/2026', {}, sel), true)
	assert.equal(isDirOpen('docs/2026/alpha', {}, sel), true)
	assert.equal(isDirOpen('other', {}, sel), false)
	assert.equal(isDirOpen('docs/2025', {}, sel), false)
})

await test('a directory that merely shares a prefix is not opened', () => {
	// 'doc' must not match 'docs/...' — the check is on a path boundary.
	assert.equal(isDirOpen('doc', {}, 'docs/a.md'), false)
})

await test('an explicit toggle always wins over the selection default', () => {
	const sel = 'docs/a.md'
	assert.equal(isDirOpen('docs', { docs: false }, sel), false, 'manual collapse is respected')
	assert.equal(isDirOpen('unrelated', { unrelated: true }, sel), true, 'manual expand is respected')
})

await test('a file directly in the workspace root opens no directory', () => {
	assert.equal(isDirOpen('docs', {}, 'readme.md'), false)
	assert.equal(isDirOpen('docs', {}, 'docs.md'), false)
})

console.log('classifyInternalLink — what a click on a rewritten link must yield')

// The exact link reported as broken, verbatim.
const REAL_LINK = '收资资料/证据标注PDF/澜沧县一体化基地220kV、110kV送出线路导线型号、长度统计.pdf#page=1'

await test('the reported link survives the rewrite/classify round trip', () => {
	const md = '[统计表 P1](' + REAL_LINK + ')'
	const rewritten = rewriteInternalLinks(md)
	const href = /\]\(([^)]+)\)/.exec(rewritten)
	assert.ok(href !== null, 'no link produced from: ' + rewritten)
	const hit = classifyInternalLink(href[1], 'http://127.0.0.1:3080')
	assert.ok(hit !== null, 'classification failed for ' + href[1])
	assert.equal(hit.kind, 'rel')
	assert.equal(hit.target, REAL_LINK)
})

await test('classification works when the platform re-encoded the path', () => {
	const hit = classifyInternalLink(REL_PREFIX + encodeURIComponent(REAL_LINK), 'http://127.0.0.1:3080')
	assert.ok(hit !== null)
	assert.equal(hit.target, REAL_LINK)
})

await test('classification works when the platform DECODED the path', () => {
	// A normalizer that decodes leaves the target literal, and an originally
	// encoded '#' becomes a real fragment — which must be re-attached, or the
	// PDF deep link silently loses its page.
	const hit = classifyInternalLink('https://dsh-mdvault.invalid/r/收资资料/a.pdf#page=1', '')
	assert.ok(hit !== null)
	assert.equal(hit.kind, 'rel')
	assert.equal(hit.target, '收资资料/a.pdf#page=1')
})

await test('an encoded fragment inside the path is preserved', () => {
	const hit = classifyInternalLink(REL_PREFIX + encodeURIComponent('a.pdf#page=7'), '')
	assert.equal(hit.target, 'a.pdf#page=7')
})

await test('wikilinks and relative links classify to different dialects', () => {
	assert.equal(classifyInternalLink(WIKI_PREFIX + encodeURIComponent('note'), '').kind, 'wiki')
	assert.equal(classifyInternalLink(REL_PREFIX + encodeURIComponent('./note.md'), '').kind, 'rel')
})

await test('foreign and malformed URLs are never claimed', () => {
	for (const href of [
		'https://example.com/a.md',
		'http://127.0.0.1:3080/somewhere',
		'https://dsh-mdvault.invalid/other/x',
		'https://dsh-mdvault.invalid/r/',
		'mailto:x@y.z',
		'#anchor',
		'',
		null,
		undefined,
		'not a url at all',
	]) {
		assert.equal(classifyInternalLink(href, 'http://127.0.0.1:3080'), null, String(href))
	}
})

await test('a relative href resolves against the provided base', () => {
	const hit = classifyInternalLink('/r/' + encodeURIComponent('a.md'), 'https://dsh-mdvault.invalid')
	assert.ok(hit !== null)
	assert.equal(hit.target, 'a.md')
})

await test('the anchor lookup finds the anchor through nested content', () => {
	const anchor = { nodeType: 1, tagName: 'A', hasAttribute: () => true }
	const span = { nodeType: 1, tagName: 'SPAN' }
	const div = { nodeType: 1, tagName: 'DIV' }
	assert.equal(anchorFromEvent({ composedPath: () => [span, anchor, div] }), anchor)
})

await test('the anchor lookup falls back to closest() without composedPath', () => {
	const anchor = { nodeType: 1, tagName: 'A' }
	assert.equal(anchorFromEvent({ target: { closest: () => anchor } }), anchor)
	assert.equal(anchorFromEvent({ target: null }), null)
})

console.log('')
console.log(passed + ' assertions passed' + (process.exitCode ? ' (with failures)' : ''))