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
const sandbox = {
	window: {
		__ModuleLoader__: {
			load(spec) { registration = spec },
		},
		location: { origin: 'http://127.0.0.1:3080' },
	},
	document: {
		head: { appendChild(el) { headChildren.push(el) } },
		getElementById() { return null },
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
	},
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

const { rewriteInternalLinks, stripFrontmatter, toRelPath, fenceFor, langForPath, isTextDoc, decodeTarget, hasMermaidFence, sanitizeSvg, isStrippedSvgElement, isStrippedSvgAttr, WIKI_PREFIX } = pure

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

test('relative markdown link is rewritten', () => {
	const out = rewriteInternalLinks('[other](./sub/other.md)')
	assert.ok(out.includes(WIKI_PREFIX + encodeURIComponent('./sub/other.md')), out)
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
	const encoded = out.slice(out.indexOf(WIKI_PREFIX) + WIKI_PREFIX.length, out.indexOf(')'))
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

await test('apply registers the 文档 tab on the conversation.view slot', async () => {
	const injected = []
	const registered = []
	const disposers = []
	const ctx = {
		effect(fn, label) { disposers.push({ label, dispose: fn() }) },
		get(name) {
			if (name === 'slots') {
				return {
					inject(key, cb) { injected.push({ key, cb }); return () => {} },
					register(options, component) { registered.push({ options, component }); return () => {} },
				}
			}
			return undefined
		},
	}
	mod.apply(ctx)
	assert.deepEqual(injected.map((i) => i.key), ['conversation.view'])
	// The slot must be declared before it can be registered into.
	injected[0].cb()
	assert.equal(registered.length, 1)
	assert.equal(registered[0].options.name, 'conversation.view')
	assert.equal(registered[0].options.id, 'mdvault')
	assert.equal(registered[0].options.label, '文档')
	assert.equal(typeof registered[0].component, 'function')
})

await test('apply injects its stylesheet exactly once', () => {
	assert.equal(headChildren.length, 1)
	assert.ok(headChildren[0].textContent.includes('.mdvault') || headChildren[0].textContent.includes('.mdv-'))
})

await test('apply tolerates a context without the slots service', () => {
	const ctx = { effect(fn) { fn() }, get() { return undefined } }
	assert.doesNotThrow(() => mod.apply(ctx))
})

await test('apply mounts the optional better-sidebar integration when present', () => {
	const viewers = []
	const tabs = []
	const ctx = {
		effect(fn) { fn() },
		get(name) {
			if (name === 'betterSidebar') {
				return {
					registerFileViewer(d) { viewers.push(d); return () => {} },
					registerTab(d) { tabs.push(d); return () => {} },
					openTab() {},
				}
			}
			return undefined
		},
	}
	mod.apply(ctx)
	assert.equal(viewers.length, 1)
	assert.equal(viewers[0].id, 'mdvault-markdown')
	assert.deepEqual([...viewers[0].exts], ['md', 'markdown'])
	assert.equal(tabs.length, 1)
	assert.equal(tabs[0].id, 'mdvault-pdf')
})

console.log('')
console.log(passed + ' assertions passed' + (process.exitCode ? ' (with failures)' : ''))