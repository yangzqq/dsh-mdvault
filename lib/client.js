/* eslint-disable */
// dsh-mdvault browser half: the conversation "文档" tab — a full main-window
// document vault with per-type viewers, plus an optional better-sidebar
// viewer integration. Loaded through the DSH client module loader.
//
// Rendering strategy: Markdown is handed to the PLATFORM's MarkdownText
// (module-seed `@deepseek-ai/dsh-client-ui-primitives`), which brings full
// GFM — tables, task lists, footnotes, KaTeX math and syntax-highlighted
// code fences — with the same CSS the chat already uses. dsh-mdvault's own
// block renderer below stays as a dependency-free fallback for DSH builds
// that do not expose that module.
window.__ModuleLoader__.load({
	id: 'dsh-mdvault',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		const React = require('react');

		// Platform UI barrel (module seed word). Optional on purpose: a build
		// that does not seed it still gets the built-in fallback renderer.
		let primitives = null;
		try { primitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch (err) { primitives = null; }
		const MarkdownText = primitives && typeof primitives.MarkdownText === 'function' ? primitives.MarkdownText : null;

		const ASSET_PREFIX = '/mdvault/asset';
		const SHEET_PREFIX = '/mdvault/sheet';

		/**
		 * Synthetic origin for internal document links. MarkdownText's link
		 * sanitizer only accepts absolute http(s)/mailto URLs and renders
		 * everything else as inert text, so `[[wikilinks]]` and relative
		 * `[label](./x.md)` links are rewritten to this reserved-TLD URL and
		 * intercepted by a click handler on the preview container. `.invalid`
		 * is reserved by RFC 2606 and can never resolve, so a missed
		 * interception is a dead tab rather than a navigation.
		 *
		 * The path segment records WHICH resolution rule applies, because the
		 * two markdown dialects differ:
		 *   /w/<target>  wikilink      — vault-root-relative, basename fallback
		 *   /r/<target>  markdown link — relative to the linking document
		 */
		const WIKI_ORIGIN = 'https://dsh-mdvault.invalid';
		const WIKI_HOST = 'dsh-mdvault.invalid';
		const WIKI_PREFIX = WIKI_ORIGIN + '/w/';
		const REL_PREFIX = WIKI_ORIGIN + '/r/';

		/**
		 * Parse a URL, absolute first and then against a base. Returns null
		 * rather than throwing, so callers can treat "unparseable" as "not ours".
		 */
		function parseUrl(href, base) {
			const h = String(href == null ? '' : href);
			if (!h) return null;
			try { return new URL(h) } catch (err) { /* not absolute */ }
			if (!base) return null;
			try { return new URL(h, base) } catch (err) { return null }
		}

		/**
		 * Decide whether a clicked href is one of OUR synthetic internal links,
		 * and recover the original target and dialect from it.
		 *
		 * Deliberately parsed rather than prefix-matched. The platform's
		 * markdown pipeline may re-normalize a URL (decoding or re-encoding the
		 * path, moving an encoded `#` into the fragment), and a raw
		 * `href.indexOf(prefix) === 0` test silently stops matching the moment
		 * that happens — the click then falls through to the browser, which
		 * opens the reserved-TLD URL in a new tab. Parsing the URL and reading
		 * its path segments survives every one of those rewrites, and the
		 * fragment is re-appended so a `#page=17` deep link still works after a
		 * decode.
		 *
		 * @returns {{kind: 'wiki'|'rel', target: string}|null}
		 */
		function classifyInternalLink(href, base) {
			const url = parseUrl(href, base);
			if (url === null || url.hostname !== WIKI_HOST) return null;
			const m = /^\/(w|r)\/(.*)$/.exec(url.pathname);
			if (m === null) return null;
			// Re-attach search/hash: if the platform decoded the path, an
			// originally-encoded `#page=1` now lives in url.hash instead.
			const tail = m[2] + (url.search || '') + (url.hash || '');
			if (!tail) return null;
			return { kind: m[1] === 'w' ? 'wiki' : 'rel', target: decodeTarget(tail) };
		}

		/**
		 * Nav registry: maps a rendered vault container to the nav object that
		 * owns it. The document-level click handler looks the owner up from the
		 * clicked anchor, so several instances (the main tab and the optional
		 * sidebar viewer) each route to the right place.
		 */
		const navByRoot = new WeakMap();

		/** The anchor a click landed in, via composedPath then closest(). */
		function anchorFromEvent(event) {
			if (typeof event.composedPath === 'function') {
				const path = event.composedPath();
				for (let i = 0; i < path.length; i++) {
					const node = path[i];
					if (node && node.nodeType === 1 && node.tagName === 'A' && node.hasAttribute('href')) return node;
				}
			}
			const target = event.target;
			return target && target.closest ? target.closest('a[href]') : null;
		}

		/**
		 * Intercept internal links at the DOCUMENT level, in the CAPTURE phase.
		 *
		 * Registered once per plugin activation rather than per component: a
		 * component-scoped listener only fires while its own container is an
		 * ancestor of the anchor, so any re-render that swaps the container (or
		 * a link rendered into another subtree) silently stops being
		 * intercepted. Capture-phase means this runs before the browser's own
		 * default action and before React's synthetic handlers, so
		 * `preventDefault()` reliably beats the platform's `target="_blank"`.
		 */
		function onDocumentClick(event) {
			if (event.defaultPrevented || event.button !== 0) return;
			const anchor = anchorFromEvent(event);
			if (anchor === null) return;
			// The attribute first (what we wrote), then the resolved property:
			// the browser may have absolutized it.
			const hit = classifyInternalLink(anchor.getAttribute('href'), originOf())
				|| classifyInternalLink(anchor.href, originOf());
			if (hit === null) return;
			// Suppress navigation unconditionally once the link is recognized —
			// even if no owner is mounted, a dead reserved-TLD tab is never
			// better than doing nothing.
			event.preventDefault();
			event.stopPropagation();
			const root = anchor.closest ? anchor.closest('[data-mdv-root]') : null;
			const nav = root === null ? undefined : navByRoot.get(root);
			if (nav !== undefined) nav.openFile(hit.target, hit.kind);
		}

		/**
		 * Shown in the toolbar. Keep in sync with package.json "version".
		 *
		 * This exists because the browser half is hot-reloaded by DSH's client
		 * HMR, and when that reload does not land the tab silently keeps running
		 * the previous build — which looks exactly like "my fix did nothing".
		 * A visible build id turns that into a one-glance answer instead of a
		 * round of guessing.
		 */
		const MDVAULT_VERSION = '1.2.3';

		/**
		 * Body attribute that hides the conversation composer while the 文档
		 * view is active. Paired with the rule in CSS; see the comment there.
		 */
		const COMPOSER_HIDE_ATTR = 'data-mdvault-hide-composer';

		// ── styles ─────────────────────────────────────────────────────────────

		const CSS = [
			'.mdv-root{display:flex;flex-direction:column;min-height:0;color:inherit}',
			'.mdv-toolbar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid rgba(127,127,127,.25);flex:0 0 auto;min-height:38px}',
			'.mdv-title{font-weight:700;font-size:13px;letter-spacing:.02em}',
			'.mdv-sub{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.55;font-size:12px}',
			'.mdv-meta{opacity:.5;font-size:12px;white-space:nowrap}',
			'.mdv-ver{opacity:.3;font-size:10.5px;font-family:ui-monospace,Consolas,monospace;white-space:nowrap}',
			'.mdv-warn{color:#e0a030;font-size:11.5px;white-space:nowrap}',
			'.mdv-btn{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px;line-height:1.4;text-decoration:none;white-space:nowrap}',
			'.mdv-btn:hover{background:rgba(127,127,127,.15)}',
			'.mdv-btn:disabled{opacity:.45;cursor:default}',
			'.mdv-btn.primary{border-color:rgba(82,155,255,.6);color:#529bff}',
			'.mdv-btn.on{border-color:rgba(82,155,255,.6);color:#529bff;background:rgba(82,155,255,.12)}',
			'.mdv-input{border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.07);color:inherit;border-radius:6px;padding:3px 8px;font-size:12px;min-width:0;flex:1}',
			'.mdv-filter{width:100%;box-sizing:border-box;margin-bottom:6px;flex:none}',
			'.mdv-body{display:flex;min-height:0}',
			// --mdv-reserve is the vertical space taken by chrome above the view
			// (conversation header + tab strip + our toolbar) plus, when shown,
			// the composer. Keeping it in one variable lets the composer-hiding
			// rule below simply shrink it instead of restating every height.
			'.mdv-root{--mdv-reserve:190px}',
			'.mdv-side{flex:0 0 auto;overflow:auto;padding:8px 6px;box-sizing:border-box;height:calc(100vh - var(--mdv-reserve));position:sticky;top:0}',
			// Drag handle between the tree and the document. The hairline is drawn
			// with a pseudo-element so the hit area can be a comfortable 7px while
			// the visible divider stays 1px (3px, highlighted, while dragging).
			'.mdv-split{flex:0 0 7px;cursor:col-resize;background:transparent;position:relative;touch-action:none}',
			'.mdv-split::after{content:"";position:absolute;top:0;bottom:0;left:3px;width:1px;background:rgba(127,127,127,.22)}',
			'.mdv-split:hover::after,.mdv-split.mdv-dragging::after{left:2px;width:3px;background:rgba(82,155,255,.55)}',
			'.mdv-main{flex:1;min-width:0;overflow:visible;padding:18px 30px 60px;line-height:1.75;box-sizing:border-box}',
			'.mdv-row{display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap;user-select:none}',
			'.mdv-row:hover{background:rgba(127,127,127,.14)}',
			'.mdv-filerow.active{background:rgba(88,140,255,.22)}',
			'.mdv-dirname{overflow:hidden;text-overflow:ellipsis}',
			'.mdv-caret{width:13px;flex:0 0 13px;opacity:.65;font-size:11px}',
			'.mdv-empty{opacity:.6;padding:26px 14px;font-size:13px;text-align:center;line-height:1.6}',
			'.mdv-docbar{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}',
			'.mdv-docpath{font-family:ui-monospace,Consolas,monospace;font-size:12px;opacity:.6;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.mdv-saveerr{color:#ff6b6b;font-size:12px;white-space:nowrap}',

			// Editor surface: a synced line-number gutter beside a plain textarea.
			'.mdv-editorwrap{display:flex;flex-direction:column;min-height:0}',
			'.mdv-editbody{display:flex;align-items:stretch;border:1px solid rgba(127,127,127,.35);border-radius:8px;overflow:hidden;background:rgba(127,127,127,.07)}',
			'.mdv-gutter{margin:0;padding:12px 8px 12px 12px;overflow:hidden;text-align:right;font-family:ui-monospace,Consolas,monospace;font-size:13px;line-height:21px;opacity:.38;user-select:none;flex:0 0 auto;border-right:1px solid rgba(127,127,127,.22);background:rgba(127,127,127,.05)}',
			'.mdv-editor{flex:1;min-width:0;box-sizing:border-box;min-height:calc(100vh - var(--mdv-reserve) - 110px);font-family:ui-monospace,Consolas,monospace;font-size:13px;line-height:21px;padding:12px;border:none;outline:none;background:transparent;color:inherit;resize:vertical;white-space:pre;overflow:auto}',
			'.mdv-findbar{display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:10px;border:1px solid rgba(127,127,127,.28);border-radius:8px;background:rgba(127,127,127,.07);flex-wrap:wrap}',

			// Markdown surfaces
			'.mdv-mdhost{position:relative}',
			'.mdv-fallback{line-height:1.75}',
			'.mdv-main h1,.mdv-main h2,.mdv-main h3,.mdv-main h4,.mdv-main h5,.mdv-main h6{line-height:1.35;margin:1.2em 0 .5em;font-weight:650}',
			'.mdv-main h1{font-size:1.7em;border-bottom:1px solid rgba(127,127,127,.25);padding-bottom:.25em}',
			'.mdv-main h2{font-size:1.4em;border-bottom:1px solid rgba(127,127,127,.18);padding-bottom:.2em}',
			'.mdv-main h3{font-size:1.2em}',
			'.mdv-main h4{font-size:1.05em}',
			'.mdv-main h5,.mdv-main h6{font-size:.95em;opacity:.9}',
			'.mdv-main p{margin:.6em 0}',
			'.mdv-main ul,.mdv-main ol{margin:.5em 0;padding-left:1.6em}',
			'.mdv-main li{margin:.2em 0}',
			'.mdv-main ul.mdv-tasklist{list-style:none;padding-left:1.2em}',
			'.mdv-main blockquote{margin:.8em 0;padding:.2em 1em;border-left:3px solid rgba(127,127,127,.45);opacity:.88}',
			'.mdv-main hr{border:none;border-top:1px solid rgba(127,127,127,.3);margin:1.4em 0}',
			'.mdv-main pre.mdv-pre{background:rgba(127,127,127,.12);border-radius:8px;padding:12px 14px;overflow:auto;margin:.8em 0}',
			'.mdv-plain{margin:0;padding:12px 14px;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.22);border-radius:8px;overflow:auto;max-height:calc(100vh - var(--mdv-reserve) - 70px);font-family:ui-monospace,Consolas,monospace;font-size:12.5px;line-height:1.6;white-space:pre;tab-size:2}',
			'.mdv-main pre.mdv-pre code{font-family:ui-monospace,Consolas,monospace;font-size:.86em;line-height:1.55;background:transparent;padding:0}',
			'.mdv-main .mdv-lang{font-size:11px;opacity:.5;margin-bottom:4px}',
			'.mdv-main :not(pre) > code{font-family:ui-monospace,Consolas,monospace;background:rgba(127,127,127,.16);padding:1px 5px;border-radius:4px;font-size:.88em}',
			'.mdv-main table{border-collapse:collapse;margin:.8em 0;font-size:.95em}',
			'.mdv-main th,.mdv-main td{border:1px solid rgba(127,127,127,.35);padding:4px 12px;text-align:left}',
			'.mdv-main th{background:rgba(127,127,127,.12)}',
			'.mdv-link{color:#529bff;text-decoration:none;cursor:pointer}',
			'.mdv-link:hover{text-decoration:underline}',
			'.mdv-wiki{color:#529bff;cursor:pointer;border-bottom:1px dashed rgba(82,155,255,.55)}',
			'.mdv-img{max-width:100%;border-radius:6px}',
			'.mdv-img-missing{opacity:.6;font-size:.9em;border:1px dashed rgba(127,127,127,.4);border-radius:4px;padding:0 6px}',
			'.mdv-task{margin-right:6px}',

			// Asset frames
			'.mdv-assetwrap{display:flex;flex-direction:column;height:calc(100vh - var(--mdv-reserve) - 20px);min-height:420px;border:1px solid rgba(127,127,127,.22);border-radius:8px;overflow:hidden}',
			'.mdv-assettbar{display:flex;align-items:center;gap:10px;padding:6px 14px;border-bottom:1px solid rgba(127,127,127,.22);flex:0 0 auto;background:rgba(127,127,127,.06);flex-wrap:wrap}',
			'.mdv-assettname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}',
			'.mdv-frame{flex:1;width:100%;border:none;background:#fff}',
			'.mdv-framewhite{background:#fff}',
			'.mdv-notice{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;opacity:.85;font-size:14px;text-align:center;padding:20px}',
			'.mdv-dl{color:#529bff;text-decoration:none;border:1px solid rgba(82,155,255,.5);border-radius:6px;padding:5px 16px;font-size:13px}',
			'.mdv-dl:hover{background:rgba(82,155,255,.12)}',

			// Image viewer: wheel zoom + drag pan
			'.mdv-imagestage{flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.06);cursor:grab;touch-action:none}',
			'.mdv-imagestage:active{cursor:grabbing}',
			'.mdv-imagezoom{max-width:100%;max-height:100%;transform-origin:center center;user-select:none;-webkit-user-drag:none;image-rendering:auto}',

			// Mermaid diagrams
			'.mdv-mermaid{display:flex;justify-content:center;overflow:auto;padding:6px 0}',
			'.mdv-mermaid svg{max-width:100%;height:auto}',
			'.mdv-mermaid-error{font-size:12px;color:#ff6b6b;padding:8px 10px;border:1px dashed rgba(255,107,107,.45);border-radius:6px;white-space:pre-wrap}',

			'.mdv-sbdoc{height:100%;overflow:auto;padding:14px 18px 48px}',
			'.mdv-sbdoc .mdv-fallback{line-height:1.75}',

			// Composer hiding.
			//
			// `data-composer-seat` is the conversation shell's own stable
			// semantic attribute on the element that holds the composer, so the
			// rule keys off that rather than a hashed CSS-module class. The body
			// attribute is set only while this view is mounted, and the view only
			// mounts while it is the ACTIVE conversation view — so the composer
			// reappears by itself the moment the user switches back to 对话.
			//
			// display:none (not visibility) so the space is actually reclaimed;
			// the element stays mounted, so an in-progress draft is preserved.
			// If a future DSH renames the attribute the rule simply stops
			// matching and the composer stays visible — a graceful no-op.
			'body[data-mdvault-hide-composer] [data-composer-seat]{display:none}',
			// Reclaim the freed height for the panels.
			'body[data-mdvault-hide-composer] .mdv-root{--mdv-reserve:70px}',
		].join('\n');

		// ── platform helpers ───────────────────────────────────────────────────

		function api(method, payload) {
			return fetch('/mdvault/api/' + method, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload || {}),
			}).then((r) => r.json()).catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
		}

		function insertStyles(css) {
			if (typeof document === 'undefined') return;
			let el = document.getElementById('dsh-mdvault-style');
			if (!el) {
				el = document.createElement('style');
				el.id = 'dsh-mdvault-style';
				document.head.appendChild(el);
			}
			el.textContent = css;
		}

		function originOf() {
			return typeof window !== 'undefined' && window.location ? window.location.origin : '';
		}

		// ── file categories ────────────────────────────────────────────────────

		var MD_RE = /\.(md|markdown|mdx)$/i;
		var SHEET_RE = /\.(xlsx|xlsm|xls|csv|tsv)$/i;
		var PDF_RE = /\.pdf$/i;
		var IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i;
		var HTML_RE = /\.html?$/i;
		var TEXT_RE = /\.(txt|log|json|json5|jsonc|ndjson|ya?ml|toml|ini|cfg|conf|env|properties|xml|plist|csv|tsv|css|scss|sass|less|styl|js|mjs|cjs|jsx|ts|tsx|mts|cts|vue|svelte|astro|py|pyi|rb|go|rs|java|kt|kts|scala|swift|dart|c|h|cc|cpp|cxx|hpp|hh|hxx|cs|m|mm|php|lua|pl|pm|r|jl|ex|exs|erl|hs|clj|groovy|sh|bash|zsh|fish|ps1|psm1|bat|cmd|sql|graphql|gql|proto|thrift|gradle|cmake|mk|tex|bib|diff|patch|rst|adoc|org|srt|vtt|dockerfile|makefile)$/i;

		/**
		 * True when a file should open in the built-in text/markdown editor.
		 * Spreadsheets are excluded even though `.csv`/`.tsv` are also plain
		 * text: the SheetJS viewer is the better surface for them.
		 */
		function isTextDoc(name) {
			if (SHEET_RE.test(name)) return false;
			return MD_RE.test(name) || TEXT_RE.test(name);
		}

		/**
		 * Viewer kind for a file name. Single source of truth for "which viewer
		 * opens this" — the tree icon, the click handler and the sidebar
		 * integration all read it rather than re-testing the regexes in
		 * different orders.
		 */
		function viewerKindFor(name) {
			if (MD_RE.test(name)) return 'note';
			if (SHEET_RE.test(name)) return 'sheet';
			if (PDF_RE.test(name)) return 'pdf';
			if (IMAGE_RE.test(name)) return 'image';
			if (HTML_RE.test(name)) return 'html';
			if (TEXT_RE.test(name)) return 'text';
			return 'file';
		}

		/** Icon per viewer kind, plus a fallback for unknown binaries. */
		var KIND_ICON = {
			note: '\uD83D\uDCDD', sheet: '\uD83D\uDCD7', pdf: '\uD83D\uDCD5',
			image: '\uD83D\uDDBC', html: '\uD83C\uDF10', text: '\uD83D\uDCBB',
			file: '\uD83D\uDCC4',
		};

		function iconFor(name) {
			return KIND_ICON[viewerKindFor(name)] || KIND_ICON.file;
		}

		// ── fence-aware markdown source rewriting ──────────────────────────────

		/**
		 * Mask fenced code blocks and inline code spans so link/image syntax
		 * shown inside documentation examples is never rewritten. Returns the
		 * masked text plus a restore function.
		 */
		function maskCode(text) {
			var masks = [];
			var masked = String(text == null ? '' : text)
				.replace(/```[\s\S]*?```/g, function (block) { masks.push(block); return '\u0000' + (masks.length - 1) + '\u0000'; })
				.replace(/~~~[\s\S]*?~~~/g, function (block) { masks.push(block); return '\u0000' + (masks.length - 1) + '\u0000'; })
				.replace(/`[^`\n]*`/g, function (span) { masks.push(span); return '\u0000' + (masks.length - 1) + '\u0000'; });
			return {
				text: masked,
				restore: function (value) {
					return value.replace(/\u0000(\d+)\u0000/g, function (_m, index) { return masks[Number(index)] === undefined ? '' : masks[Number(index)]; });
				},
			};
		}

		/** Encode a link target so markdown's `<dest>` grammar cannot be broken. */
		function encodeTarget(target) {
			return encodeURIComponent(target).replace(/[()!'*]/g, function (c) {
				return '%' + c.charCodeAt(0).toString(16).toUpperCase();
			});
		}

		function decodeTarget(raw) {
			try { return decodeURIComponent(raw); } catch (err) { return raw; }
		}

		/** Escape a link label so `[`/`]` cannot terminate it early. */
		function escapeLabel(label) {
			return String(label).replace(/([\\[\]])/g, '\\$1');
		}

		/**
		 * Rewrite Obsidian-style `[[target]]` / `[[target|label]]` wikilinks and
		 * relative markdown links into internal `WIKI_ORIGIN` URLs the preview
		 * click handler intercepts.
		 */
		function rewriteInternalLinks(source) {
			var m = maskCode(source);
			var text = m.text;

			// [[target|label]] / [[target#frag|label]] / [[target]]
			text = text.replace(/\[\[([^\]\n]+)\]\]/g, function (_all, inner) {
				var bar = inner.indexOf('|');
				var target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
				var label = (bar >= 0 ? inner.slice(bar + 1) : inner).trim();
				if (!target) return _all;
				return '[' + escapeLabel(label || target) + '](' + WIKI_PREFIX + encodeTarget(target) + ')';
			});

			// [label](./relative.md) — only relative/local destinations; remote
			// URLs, anchors and the wiki URLs produced above stay untouched.
			// The destination allows one level of balanced parentheses so a
			// path like `./a(1).md` is not truncated at the first `)`.
			text = text.replace(/(!?)\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(\s+"[^"]*")?\)/g, function (all, bang, label, dest, title) {
				if (bang === '!') return all;
				if (!dest || /^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.charAt(0) === '#') return all;
				if (dest.indexOf(WIKI_ORIGIN) === 0) return all;
				return '[' + label + '](' + REL_PREFIX + encodeTarget(dest) + (title || '') + ')';
			});

			return m.restore(text);
		}

		/**
		 * Hide a leading closed YAML frontmatter block from the PREVIEW only
		 * (MarkdownText would read its `---` delimiters as a rule plus a setext
		 * heading). Unclosed or non-leading delimiters pass through untouched.
		 */
		function stripFrontmatter(source) {
			var text = String(source == null ? '' : source);
			var firstEnd = text.indexOf('\n');
			if (firstEnd < 0) return text;
			var firstStart = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
			if (text.slice(firstStart, firstEnd).replace(/\r$/, '') !== '---') return text;
			var lineStart = firstEnd + 1;
			while (lineStart <= text.length) {
				var nl = text.indexOf('\n', lineStart);
				var lineEnd = nl < 0 ? text.length : nl;
				if (text.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
					return nl < 0 ? '' : text.slice(nl + 1);
				}
				if (nl < 0) return text;
				lineStart = nl + 1;
			}
			return text;
		}

		/**
		 * Resolve a markdown link/image destination relative to the document
		 * that contains it. Thin wrapper over resolveRelPath so image and link
		 * destinations cannot drift apart.
		 */
		function toRelPath(dest, currentPath) {
			return resolveRelPath(dest, dirNameOf(currentPath));
		}

		/** The directory part of a workspace-relative path ('' at the root). */
		function dirNameOf(path) {
			const parts = String(path == null ? '' : path).split('/');
			parts.pop();
			return parts.join('/');
		}

		/** Absolute asset URL for one workspace-relative path. */
		function assetUrlFor(sessionId, rel, frag) {
			return originOf() + ASSET_PREFIX + '/' + encodeURIComponent(sessionId) + '/' + encodeURIComponent(rel) + (frag ? '#' + frag : '');
		}

		function sheetUrlFor(sessionId, rel) {
			return SHEET_PREFIX + '?sessionId=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(rel);
		}

		// ── fallback markdown renderer (used when MarkdownText is absent) ──────

		let uid = 0;

		function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

		function inlineNodes(text, nav, depth) {
			if (depth > 4) return [String(text == null ? '' : text)];
			const src = String(text == null ? '' : text);
			const out = [];
			const re = /\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~|`([^`\n]+)`|\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(([^)\n]*)\)|\[([^\]\n]+)\]\(([^)\n]*)\)/g;
			let last = 0;
			let m;
			while ((m = re.exec(src)) !== null) {
				if (m.index > last) out.push(src.slice(last, m.index));
				const k = 'i' + (uid++);
				if (m[1] !== undefined || m[2] !== undefined) {
					out.push(React.createElement('strong', { key: k }, inlineNodes(m[1] !== undefined ? m[1] : m[2], nav, depth + 1)));
				} else if (m[3] !== undefined || m[4] !== undefined) {
					out.push(React.createElement('em', { key: k }, inlineNodes(m[3] !== undefined ? m[3] : m[4], nav, depth + 1)));
				} else if (m[5] !== undefined) {
					out.push(React.createElement('del', { key: k }, inlineNodes(m[5], nav, depth + 1)));
				} else if (m[6] !== undefined) {
					out.push(React.createElement('code', { key: k }, m[6]));
				} else if (m[7] !== undefined) {
					const inner = m[7];
					const bar = inner.indexOf('|');
					const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
					const label = (bar >= 0 ? inner.slice(bar + 1) : inner).trim();
					out.push(React.createElement('span', {
						key: k, className: 'mdv-wiki', title: target,
						onClick: function (e) { e.preventDefault(); nav.openFile(target); },
					}, label || target));
				} else if (m[8] !== undefined) {
					const alt = m[8];
					const srcAttr = (m[9] || '').trim();
					const resolved = nav.assetUrl(srcAttr);
					if (resolved) out.push(React.createElement('img', { key: k, className: 'mdv-img', src: resolved, alt: alt }));
					else if (/^https?:\/\//i.test(srcAttr)) out.push(React.createElement('img', { key: k, className: 'mdv-img', src: srcAttr, alt: alt }));
					else out.push(React.createElement('span', { key: k, className: 'mdv-img-missing', title: srcAttr }, '\uD83D\uDDBC ' + (alt || srcAttr)));
				} else if (m[10] !== undefined) {
					const label = m[10];
					const href = (m[11] || '').trim();
					if (/^https?:\/\//i.test(href)) {
						out.push(React.createElement('a', { key: k, className: 'mdv-link', href: href, target: '_blank', rel: 'noreferrer' }, inlineNodes(label, nav, depth + 1)));
					} else {
						out.push(React.createElement('span', { key: k, className: 'mdv-link', title: href, onClick: function (e) { e.preventDefault(); nav.openFile(href); } }, inlineNodes(label, nav, depth + 1)));
					}
				}
				last = re.lastIndex;
				if (re.lastIndex === m.index) re.lastIndex += 1;
			}
			if (last < src.length) out.push(src.slice(last));
			return out;
		}

		function blockNodes(text, nav) {
			const lines = String(text == null ? '' : text).replace(/\t/g, '  ').split(/\r\n|\r|\n/);
			const blocks = [];
			let i = 0;
			while (i < lines.length) {
				const raw = lines[i];
				const fm = raw.match(/^\s*(```+|~~~+)(.*)$/);
				if (fm) {
					const ch = fm[1].charAt(0);
					const len = fm[1].length;
					const lang = fm[2].trim();
					const buf = [];
					i += 1;
					const closeRe = new RegExp('^\\s*' + escRe(ch) + '{' + len + ',}\\s*$');
					while (i < lines.length) {
						if (closeRe.test(lines[i])) { i += 1; break; }
						buf.push(lines[i]);
						i += 1;
					}
					blocks.push(React.createElement('pre', { key: 'b' + (uid++), className: 'mdv-pre' },
						lang ? React.createElement('div', { className: 'mdv-lang' }, lang) : null,
						React.createElement('code', null, buf.join('\n')),
					));
					continue;
				}
				const hm = raw.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
				if (hm) {
					blocks.push(React.createElement('h' + hm[1].length, { key: 'b' + (uid++) }, inlineNodes(hm[2], nav, 0)));
					i += 1;
					continue;
				}
				if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
					blocks.push(React.createElement('hr', { key: 'b' + (uid++) }));
					i += 1;
					continue;
				}
				if (!raw.trim()) { i += 1; continue; }
				if (/^\s*>/.test(raw)) {
					const q = [];
					while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
					blocks.push(React.createElement('blockquote', { key: 'b' + (uid++) }, blockNodes(q.join('\n'), nav)));
					continue;
				}
				if (raw.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
					const cells = function (l) { return l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); }); };
					const head = cells(raw);
					i += 2;
					const rows = [];
					while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) { rows.push(cells(lines[i])); i += 1; }
					blocks.push(React.createElement('table', { key: 'b' + (uid++) },
						React.createElement('thead', null, React.createElement('tr', null, head.map(function (c, ci) { return React.createElement('th', { key: ci }, inlineNodes(c, nav, 0)); }))),
						React.createElement('tbody', null, rows.map(function (r, ri) { return React.createElement('tr', { key: ri }, r.map(function (c, ci) { return React.createElement('td', { key: ci }, inlineNodes(c, nav, 0)); })); })),
					));
					continue;
				}
				const lm = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
				if (lm) {
					const items = [];
					while (i < lines.length) {
						const m2 = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
						if (!m2) break;
						let txt = m2[3];
						let task = null;
						const tm = txt.match(/^\[( |x|X)\]\s+(.*)$/);
						if (tm) { task = tm[1] !== ' '; txt = tm[2]; }
						items.push({ indent: m2[1].length, ordered: /\d/.test(m2[2].charAt(0)), text: txt, task: task, children: [] });
						i += 1;
					}
					const roots = [];
					const stk = [];
					for (const it of items) {
						while (stk.length && stk[stk.length - 1].indent >= it.indent) stk.pop();
						if (!stk.length) roots.push(it);
						else stk[stk.length - 1].children.push(it);
						stk.push(it);
					}
					const renderList = function (arr) {
						return React.createElement(arr[0].ordered ? 'ol' : 'ul', { key: 'ls' + (uid++), className: arr[0].task !== null ? 'mdv-tasklist' : '' }, arr.map(function (it) {
							const kids = [];
							if (it.task !== null) kids.push(React.createElement('span', { key: 'tk', className: 'mdv-task' }, it.task ? '\u2611' : '\u2610'));
							kids.push.apply(kids, inlineNodes(it.text, nav, 0));
							const liKids = [React.createElement('span', { key: 'c' }, kids)];
							if (it.children.length) liKids.push(renderList(it.children));
							return React.createElement('li', { key: 'li' + (uid++) }, liKids);
						}));
					};
					blocks.push(renderList(roots));
					continue;
				}
				const pbuf = [raw];
				i += 1;
				while (i < lines.length && lines[i].trim()
					&& !/^#{1,6}\s/.test(lines[i])
					&& !/^\s*>/.test(lines[i])
					&& !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i])
					&& !/^\s*(```|~~~)/.test(lines[i])) {
					pbuf.push(lines[i]);
					i += 1;
				}
				blocks.push(React.createElement('p', { key: 'b' + (uid++) }, inlineNodes(pbuf.join('\n'), nav, 0)));
			}
			return blocks;
		}

		// ── mermaid diagrams ───────────────────────────────────────────────────

		/**
		 * CommonMark fence detection, used only to decide whether the (large)
		 * mermaid bundle is worth fetching. 0-3 spaces indent, 3+ backticks or
		 * tildes, info string naming mermaid (bare or `mermaid{...}`).
		 */
		function hasMermaidFence(text) {
			const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
			for (let i = 0; i < lines.length; i++) {
				const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
				if (!open) continue;
				const fence = open[1];
				const info = open[2].trimStart().split(/\s+/)[0] || '';
				if (fence.charAt(0) === '`' && info.indexOf('`') >= 0) continue;
				const lower = info.toLowerCase();
				if (lower !== 'mermaid' && lower.indexOf('mermaid{') !== 0) continue;
				// Confirm it closes, so a stray word in prose cannot trigger a load.
				const closeRe = new RegExp('^ {0,3}' + escRe(fence.charAt(0)) + '{' + fence.length + ',}[ \\t]*$');
				for (let j = i + 1; j < lines.length; j++) if (closeRe.test(lines[j])) return true;
				return false;
			}
			return false;
		}

		/** Element names stripped from rendered SVG (matched lowercased). */
		const SVG_STRIP = {
			foreignobject: 1, script: 1, img: 1, iframe: 1, object: 1, embed: 1,
			video: 1, audio: 1, input: 1, button: 1, form: 1, link: 1, meta: 1, base: 1,
		};

		/**
		 * Should this SVG element be removed? XML preserves element case while
		 * the sanitized string is re-parsed as HTML (whose parser normalizes
		 * casing), so `<sCrIpT>` / `<foreignobject>` must be caught too.
		 */
		function isStrippedSvgElement(localName) {
			return SVG_STRIP[String(localName == null ? '' : localName).toLowerCase()] === 1;
		}

		/**
		 * Should this SVG attribute be removed? Covers the event-handler
		 * channels (`on*`, Vue-style `@*`) and every link (`href`,
		 * `xlink:href`) — the diagrams are static, so a link only adds a way to
		 * navigate the GUI away. Case-insensitive for the same reason as above.
		 */
		function isStrippedSvgAttr(name) {
			const low = String(name == null ? '' : name).toLowerCase();
			if (low.indexOf('@') === 0 || low.indexOf('on') === 0) return true;
			return low === 'href' || low === 'xlink:href';
		}

		/**
		 * Sanitize mermaid's SVG output (defense in depth over mermaid's own
		 * `securityLevel: 'strict'`). Parsing as image/svg+xml makes a malformed
		 * document fail wholesale rather than pass through, and only an <svg>
		 * root is accepted.
		 */
		function sanitizeSvg(svg) {
			if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return '';
			let doc;
			try { doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); } catch (err) { return ''; }
			if (doc.querySelector('parsererror') !== null) return '';
			if (!doc.documentElement || doc.documentElement.localName !== 'svg') return '';
			const all = doc.querySelectorAll('*');
			for (let i = 0; i < all.length; i++) {
				const node = all[i];
				if (isStrippedSvgElement(node.localName)) { node.remove(); continue; }
				// Snapshot before mutating: removeAttribute during a live
				// NamedNodeMap iteration would skip entries.
				const attrs = Array.prototype.slice.call(node.attributes);
				for (let a = 0; a < attrs.length; a++) {
					if (isStrippedSvgAttr(attrs[a].name)) node.removeAttribute(attrs[a].name);
				}
			}
			return new XMLSerializer().serializeToString(doc.documentElement);
		}

		/** One in-flight load of the mermaid bundle, memoized per page. */
		let mermaidLoad = null;
		let mermaidSeq = 0;

		function loadMermaid() {
			if (mermaidLoad !== null) return mermaidLoad;
			mermaidLoad = new Promise(function (resolve, reject) {
				const existing = typeof globalThis !== 'undefined' ? globalThis.mermaid : undefined;
				if (existing && typeof existing.render === 'function') { resolve(existing); return; }
				const el = document.createElement('script');
				el.async = true;
				el.src = '/mdvault/mermaid.js';
				el.addEventListener('load', function () {
					el.remove();
					const lib = globalThis.mermaid;
					if (!lib || typeof lib.render !== 'function') { reject(new Error('mermaid 未注册全局变量')); return; }
					resolve(lib);
				}, { once: true });
				el.addEventListener('error', function () {
					el.remove();
					reject(new Error('mermaid 脚本加载失败'));
				}, { once: true });
				document.head.appendChild(el);
			});
			// A failed load must be retryable.
			mermaidLoad.catch(function () { mermaidLoad = null; });
			return mermaidLoad;
		}

		function isDark() {
			if (typeof document === 'undefined' || !document.body) return false;
			if (document.body.hasAttribute('data-ds-dark-theme')) return true;
			try {
				return typeof window !== 'undefined' && window.matchMedia
					? window.matchMedia('(prefers-color-scheme: dark)').matches
					: false;
			} catch (err) { return false; }
		}

		/**
		 * Replace every rendered ```mermaid block inside `container` with the
		 * diagram. The platform renderer emits `<div class="md-code-block">`
		 * wrappers whose <code> carries `language-mermaid`, so the swap keeps
		 * React's host node and only replaces its children (the same technique
		 * better-sidebar uses). Idempotent: a block already carrying
		 * data-mermaid is skipped, so a re-render cannot double-render.
		 */
		async function renderMermaidBlocks(container) {
			if (typeof document === 'undefined') return;
			const blocks = container.querySelectorAll('.md-code-block');
			const targets = [];
			for (let i = 0; i < blocks.length; i++) {
				const block = blocks[i];
				if (block.getAttribute('data-mermaid') !== null) continue;
				const code = block.querySelector('code');
				if (!code) continue;
				let isMermaid = false;
				const classes = code.classList;
				for (let c = 0; c < classes.length; c++) if (classes[c].indexOf('language-mermaid') === 0) isMermaid = true;
				if (!isMermaid) continue;
				block.setAttribute('data-mermaid', 'pending');
				targets.push({ block: block, source: code.textContent || '' });
			}
			if (!targets.length) return;

			let lib;
			try {
				lib = await loadMermaid();
			} catch (err) {
				for (const t of targets) t.block.setAttribute('data-mermaid', 'error');
				console.warn('[dsh-mdvault] mermaid unavailable:', err);
				return;
			}
			try {
				lib.initialize({
					startOnLoad: false,
					// Labels escaped and click directives inert; htmlLabels off keeps
					// node text as real SVG <text> instead of a foreignObject.
					securityLevel: 'strict',
					htmlLabels: false,
					// Mermaid otherwise injects its own error SVG into the document.
					suppressErrorRendering: true,
					theme: isDark() ? 'dark' : 'default',
				});
			} catch (err) { /* an already-initialized instance is fine */ }

			for (const t of targets) {
				const id = 'mdv-mmd-' + (mermaidSeq++);
				try {
					const out = await lib.render(id, t.source);
					const svg = sanitizeSvg(out && out.svg ? out.svg : '');
					if (!svg) throw new Error('图形未通过安全校验');
					const host = document.createElement('div');
					host.className = 'mdv-mermaid';
					host.innerHTML = svg;
					t.block.replaceChildren(host);
					t.block.setAttribute('data-mermaid', 'done');
				} catch (err) {
					t.block.setAttribute('data-mermaid', 'error');
					const notice = document.createElement('div');
					notice.className = 'mdv-mermaid-error';
					notice.textContent = '\u26A0 mermaid 渲染失败：' + ((err && err.message) || String(err));
					t.block.replaceChildren(notice);
				}
			}
		}

		/**
		 * Resolve a link target to a workspace-relative path.
		 *
		 * `base` is the directory to resolve a document-relative target against
		 * ('' for the workspace root). Parent segments are CLAMPED at the root
		 * rather than rejected, so `../sibling.md` works and can never escape.
		 * Returns null for an empty result or a dot-prefixed segment (the host
		 * fence rejects those anyway).
		 */
		function resolveRelPath(target, base) {
			let raw = String(target == null ? '' : target).trim();
			if (!raw) return null;
			try { raw = decodeURIComponent(raw); } catch (err) { /* keep raw */ }
			raw = raw.split('#')[0].split('?')[0].replace(/\\/g, '/');
			if (!raw) return null;
			// A leading slash is workspace-root-absolute.
			const rooted = raw.charAt(0) === '/';
			const joined = rooted || !base ? raw.replace(/^\//, '') : base + '/' + raw;
			const out = [];
			const segs = joined.split('/');
			for (let i = 0; i < segs.length; i++) {
				const s = segs[i];
				if (!s || s === '.') continue;
				if (s === '..') { out.pop(); continue; }
				if (s.charAt(0) === '.') return null;
				out.push(s);
			}
			return out.length ? out.join('/') : null;
		}

		/**
		 * Decide how an intercepted link should open, as a pure function of the
		 * target, the linking document and the (optional) file listing.
		 *
		 * Resolution no longer depends on the listing: a target with a known
		 * file extension is resolved against the linking document's own
		 * directory, exactly like an embedded image. The earlier code consulted
		 * the tree first and fell back to a ROOT-relative path when the lookup
		 * missed, so any file outside the listing (too deep, past the file cap,
		 * or under a skipped directory) resolved to the wrong place and 404ed.
		 * The listing is now used only to disambiguate extension-less wikilinks
		 * (note names), which have no extension to classify.
		 *
		 * @returns {{kind: 'note'|'pdf'|'image'|'html'|'sheet'|'text'|'file', rel: string, frag: string}|null}
		 */
		function resolveOpenTarget(rawTarget, currentPath, kind, fileList) {
			let t = String(rawTarget == null ? '' : rawTarget).trim().replace(/\\/g, '/');
			if (!t) return null;
			let frag = '';
			const hi = t.indexOf('#');
			if (hi >= 0) { frag = t.slice(hi + 1); t = t.slice(0, hi); }
			if (!t) return null;

			const base = dirNameOf(currentPath);
			const name = t.split('/').pop();

			// Markdown notes.
			if (MD_RE.test(name)) {
				let rel = resolveRelPath(t, base);
				if (!rel) return null;
				return { kind: 'note', rel: rel, frag: frag };
			}

			// Extension-less: a wikilink note name, or a link to an
			// extension-less text file. Try the listing to find the real file.
			if (!/\.[a-z0-9]+$/i.test(name)) {
				const list = Array.isArray(fileList) ? fileList : [];
				const candidates = [];
				const documentRel = resolveRelPath(t, base);
				if (documentRel) candidates.push(documentRel);
				// A wikilink path is vault-root-relative in Obsidian.
				if (kind === 'wiki') {
					const rootRel = resolveRelPath(t, '');
					if (rootRel) candidates.push(rootRel);
				}
				for (const cand of candidates) {
					const hit = findByPathIn(list, cand);
					if (hit) return { kind: 'note', rel: hit.path, frag: frag };
				}
				// Last resort: match a note by basename anywhere in the vault.
				const needle = name.toLowerCase();
				for (const f of list) {
					const bare = f.name.toLowerCase().replace(/\.(md|markdown|mdx)$/i, '');
					if (bare === needle) return { kind: 'note', rel: f.path, frag: frag };
				}
				if (!documentRel) return null;
				// An extension-less non-note (Dockerfile, Makefile, ...).
				return { kind: 'text', rel: documentRel, frag: frag };
			}

			// Anything with an extension resolves like an image: against the
			// linking document's directory. The viewer kind comes from the one
			// shared classifier, so this cannot disagree with the tree or the
			// click handler.
			const rel = resolveRelPath(t, base);
			if (!rel) return null;
			return { kind: viewerKindFor(name), rel: rel, frag: frag };
		}

		/**
		 * Exact-path lookup in a listing. A request without an extension also
		 * matches a markdown file (`[[note]]` → `note.md`), and because authors
		 * mix them freely, any markdown-family extension matches any other
		 * (`note.markdown` finds `note.md`) — MD_RE already covers that family.
		 */
		function findByPathIn(list, p) {
			const pl = String(p || '').toLowerCase();
			if (!pl) return null;
			for (const f of list) { if (f.path.toLowerCase() === pl) return f; }
			// Extension-less request: try the markdown family.
			for (const f of list) {
				const fp = f.path.toLowerCase();
				if (fp === pl + '.md' || fp === pl + '.markdown' || fp === pl + '.mdx') return f;
			}
			// Markdown-family request: compare stems so a wrong-but-equivalent
			// extension still resolves.
			if (MD_RE.test(pl)) {
				const stem = pl.replace(MD_RE, '');
				for (const f of list) {
					const fp = f.path.toLowerCase();
					if (MD_RE.test(fp) && fp.replace(MD_RE, '') === stem) return f;
				}
			}
			return null;
		}

		/**
		 * Whether a directory row is expanded.
		 *
		 * Default is COLLAPSED, except for the ancestors of the selected file,
		 * which open so the current document is visible. The previous rule was
		 * `!collapsed[path]`, which made every directory open on first paint —
		 * rendering one DOM row per file in the whole workspace, which is what
		 * made the tab sluggish on a large tree. An explicit toggle is stored
		 * in `collapsed` and always wins, so a manual collapse is respected.
		 */
		function isDirOpen(dirPath, collapsedMap, selectedPath) {
			const override = collapsedMap ? collapsedMap[dirPath] : undefined;
			if (override !== undefined) return override === true;
			if (!selectedPath) return false;
			return selectedPath.indexOf(dirPath + '/') === 0;
		}

		// ── file tree ──────────────────────────────────────────────────────────

		/** Build the directory tree for a flat file listing. */
		function buildTree(files) {
			const rootNode = { dirs: new Map(), files: [] };
			for (const f of files) {
				const segs = f.path.split('/');
				let node = rootNode;
				for (let d = 0; d < segs.length - 1; d++) {
					const s = segs[d];
					const path = segs.slice(0, d + 1).join('/');
					if (!node.dirs.has(s)) node.dirs.set(s, { name: s, path: path, dirs: new Map(), files: [] });
					node = node.dirs.get(s);
				}
				node.files.push(f);
			}
			return rootNode;
		}

		/** Render one directory level into flat rows (recursing into open ones). */
		function renderDir(node, depth, ctx) {
			const rows = [];
			const dirNames = Array.from(node.dirs.keys()).sort();
			for (const dn of dirNames) {
				const child = node.dirs.get(dn);
				// A filter forces every matching branch open; otherwise only the
				// path down to the current document is expanded.
				const isOpen = ctx.filtering || isDirOpen(child.path, ctx.collapsed, ctx.selected);
				rows.push(React.createElement('div', {
					key: 'd' + child.path,
					className: 'mdv-row',
					style: { paddingLeft: 8 + depth * 14 },
					title: child.path,
					onClick: function () { ctx.onToggleDir(child.path, !isOpen); },
				},
					React.createElement('span', { className: 'mdv-caret' }, isOpen ? '\u25BE' : '\u25B8'),
					React.createElement('span', { className: 'mdv-dirname' }, '\uD83D\uDCC1 ' + dn),
				));
				if (isOpen) {
					const sub = renderDir(child, depth + 1, ctx);
					for (const r of sub) rows.push(r);
				}
			}
			for (const f of node.files) {
				rows.push(React.createElement('div', {
					key: 'f' + f.path,
					className: 'mdv-row mdv-filerow' + (f.path === ctx.selected ? ' active' : ''),
					style: { paddingLeft: 24 + depth * 14 },
					title: f.path,
					onClick: function () { ctx.onSelect(f); },
				}, iconFor(f.name) + ' ' + f.name));
			}
			return rows;
		}

		/**
		 * The workspace tree: a filter box plus the nested rows.
		 *
		 * Extracted from MdVaultView, which was doing two unrelated jobs (the
		 * tree and the document pane) in one 400-line component. This half owns
		 * only "which files exist and which are expanded"; the pane owns
		 * nothing but rendering the current selection.
		 *
		 * Building the rows creates one React element per file, so the result is
		 * memoized: without it every filter keystroke and every document switch
		 * rebuilt every element in the workspace.
		 */
		function FileTree(props) {
			const files = props.files;
			const filter = props.filter;
			const selected = props.selected;
			const collapsed = props.collapsed;
			const onToggleDir = props.onToggleDir;
			const onSelect = props.onSelect;

			const fileList = files || [];
			const needle = filter.trim().toLowerCase();
			const visible = React.useMemo(function () {
				if (!needle) return fileList;
				return fileList.filter(function (f) { return f.path.toLowerCase().indexOf(needle) >= 0; });
			}, [fileList, needle]);

			const rows = React.useMemo(function () {
				if (!visible.length) return null;
				return renderDir(buildTree(visible), 0, {
					collapsed: collapsed, selected: selected, filtering: !!needle,
					onToggleDir: onToggleDir, onSelect: onSelect,
				});
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [visible, collapsed, selected, needle]);

			if (props.error) return React.createElement('div', { className: 'mdv-empty' }, '\u26A0\uFE0F ' + props.error);
			if (files === null) return React.createElement('div', { className: 'mdv-empty' }, '正在扫描工作区…');
			if (!fileList.length) return React.createElement('div', { className: 'mdv-empty' }, '当前工作区里没有找到可预览的文件');
			if (!visible.length) return React.createElement('div', { className: 'mdv-empty' }, '没有匹配「' + filter + '」的文件');
			return rows;
		}

		// ── markdown view: platform renderer with internal-link interception ───

		/**
		 * One markdown document. `nav.openFile(target)` handles both wikilinks
		 * and relative links; `nav.assetUrl(href)` resolves local images.
		 */
		function MarkdownView(props) {
			const text = typeof props.text === 'string' ? props.text : '';
			const nav = props.nav;
			const hostRef = React.useRef(null);

			// `nav` is rebuilt by the parent on every render, so keep it in a ref
			// and register the click listener exactly once. Depending on
			// nav.openFile directly would detach/reattach the listener on every
			// render (and drop a click that lands mid-render).
			const navRef = React.useRef(nav);
			navRef.current = nav;

			const sessionKey = nav.sessionId;
			const pathKey = nav.currentPath;

			const prepared = React.useMemo(function () {
				return rewriteInternalLinks(text);
			}, [text, sessionKey, pathKey]);

			// Frontmatter stripping and mermaid detection are both O(document).
			// They must be memoized: stripFrontmatter otherwise returns a fresh
			// string on every render, which changes MarkdownText's `text` prop
			// identity and forces a FULL reparse plus re-highlight of the whole
			// document each time.
			const displayText = React.useMemo(function () {
				return stripFrontmatter(prepared);
			}, [prepared]);

			const wantMermaid = React.useMemo(function () {
				return MarkdownText !== null && hasMermaidFence(prepared);
			}, [prepared]);

			// pathImages is the platform's own hook for local image files: the
			// renderer calls resolve(dest) and uses the result only when it is
			// an absolute http(s)/blob/data URL.
			const pathImages = React.useMemo(function () {
				return {
					resolve: function (dest) {
						const rel = toRelPath(dest, navRef.current.currentPath);
						if (!rel) return undefined;
						return assetUrlFor(navRef.current.sessionId, rel, '');
					},
				};
			}, [sessionKey, pathKey]);

			const labels = React.useMemo(function () {
				return { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '' };
			}, []);

			// Swap ```mermaid fences for diagrams once the platform renderer has
			// mounted, and again whenever it re-renders its subtree (highlighting
			// settling, streaming updates). The pass is idempotent.
			// (wantMermaid is memoized above, on `prepared`.)
			React.useEffect(function () {
				if (!wantMermaid) return;
				const host = hostRef.current;
				if (host === null) return;
				let scheduled = false;
				const run = function () {
					if (scheduled) return;
					scheduled = true;
					Promise.resolve().then(function () {
						scheduled = false;
						void renderMermaidBlocks(host);
					});
				};
				run();
				if (typeof MutationObserver === 'undefined') return;
				const observer = new MutationObserver(run);
				observer.observe(host, { childList: true, subtree: true });
				return function () { observer.disconnect(); };
			}, [wantMermaid, prepared]);

			if (MarkdownText === null) {
				return React.createElement('div', { className: 'mdv-fallback' }, blockNodes(displayText, nav));
			}
			return React.createElement('div', { className: 'mdv-mdhost', ref: hostRef },
				React.createElement(MarkdownText, {
					text: displayText,
					labels: labels,
					pathImages: pathImages,
				}),
			);
		}
		// Memoized so a parent re-render (tree filter keystroke, selection
		// change) cannot re-run the O(document) preparation above.
		const MarkdownViewMemo = React.memo(MarkdownView);

		// ── viewers ────────────────────────────────────────────────────────────

		/** Browser-native PDF preview via a Blob URL (never downloads). */
		function PdfView(props) {
			const url = props.url;
			const title = props.title;
			// The `#page=` fragment must be re-attached to the Blob URL: the
			// blob has a different address than the asset URL it came from, so
			// the deep-link target would otherwise be dropped and the viewer
			// would always open at page 1.
			const frag = typeof props.frag === 'string' && props.frag ? props.frag : '';
			const state = React.useState({ status: 'loading' });
			const load = state[0];
			const setLoad = state[1];

			React.useEffect(function () {
				let objectUrl = '';
				let alive = true;
				const controller = typeof AbortController === 'function' ? new AbortController() : null;
				setLoad({ status: 'loading' });
				fetch(url, controller ? { signal: controller.signal } : undefined)
					.then(function (r) {
						if (!r.ok) throw new Error('HTTP ' + r.status);
						return r.arrayBuffer();
					})
					.then(function (bytes) {
						if (!alive) return;
						// An explicit PDF MIME keeps the browser's viewer in charge:
						// a cached application/octet-stream would download instead.
						objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
						const withPage = /^page=/.test(frag) ? objectUrl + '#' + frag : objectUrl;
						setLoad({ status: 'ready', url: withPage });
					})
					.catch(function (err) {
						if (!alive) return;
						setLoad({ status: 'error', message: String((err && err.message) || err) });
					});
				return function () {
					alive = false;
					if (controller) controller.abort();
					if (objectUrl) URL.revokeObjectURL(objectUrl);
				};
			}, [url, frag]);

			const download = React.createElement('a', { className: 'mdv-btn', href: url, download: title }, '\u2B07 下载');
			if (load.status === 'loading') {
				return React.createElement('div', { className: 'mdv-assetwrap' },
					React.createElement('div', { className: 'mdv-assettbar' }, download,
						React.createElement('span', { className: 'mdv-assettname' }, '\uD83D\uDCD5 ' + title)),
					React.createElement('div', { className: 'mdv-notice' }, '正在加载 PDF…'));
			}
			if (load.status === 'error') {
				return React.createElement('div', { className: 'mdv-assetwrap' },
					React.createElement('div', { className: 'mdv-assettbar' }, download,
						React.createElement('span', { className: 'mdv-assettname' }, '\uD83D\uDCD5 ' + title)),
					React.createElement('div', { className: 'mdv-notice' },
						React.createElement('div', null, '\u26A0\uFE0F PDF 读取失败：' + load.message),
						React.createElement('a', { className: 'mdv-dl', href: url, download: title }, '\u2B07 下载文件')));
			}
			return React.createElement('div', { className: 'mdv-assetwrap' },
				React.createElement('div', { className: 'mdv-assettbar' }, download,
					React.createElement('span', { className: 'mdv-assettname' }, '\uD83D\uDCD5 ' + title)),
				React.createElement('iframe', { key: load.url, className: 'mdv-frame', src: load.url, title: title }));
		}

		/** Image viewer with wheel zoom, drag pan, and a fit/reset toolbar. */
		function ImageView(props) {
			const url = props.url;
			const title = props.title;
			const zoomState = React.useState(1);
			const zoom = zoomState[0];
			const setZoom = zoomState[1];
			const offState = React.useState({ x: 0, y: 0 });
			const offset = offState[0];
			const setOffset = offState[1];
			const dragRef = React.useRef(null);
			const stageRef = React.useRef(null);

			React.useEffect(function () { setZoom(1); setOffset({ x: 0, y: 0 }); }, [url]);

			const onWheel = React.useCallback(function (event) {
				event.preventDefault();
				setZoom(function (prev) {
					const next = prev * (event.deltaY < 0 ? 1.12 : 1 / 1.12);
					return Math.min(12, Math.max(0.1, next));
				});
			}, []);

			React.useEffect(function () {
				const stage = stageRef.current;
				if (stage === null) return;
				stage.addEventListener('wheel', onWheel, { passive: false });
				return function () { stage.removeEventListener('wheel', onWheel); };
			}, [onWheel]);

			function onPointerDown(event) {
				dragRef.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
				if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
			}
			function onPointerMove(event) {
				if (!dragRef.current) return;
				setOffset({ x: event.clientX - dragRef.current.x, y: event.clientY - dragRef.current.y });
			}
			function onPointerUp() { dragRef.current = null; }

			return React.createElement('div', { className: 'mdv-assetwrap' },
				React.createElement('div', { className: 'mdv-assettbar' },
					React.createElement('button', { className: 'mdv-btn', onClick: function () { setZoom(function (z) { return Math.min(12, z * 1.25); }); } }, '\uFF0B'),
					React.createElement('button', { className: 'mdv-btn', onClick: function () { setZoom(function (z) { return Math.max(0.1, z / 1.25); }); } }, '\uFF0D'),
					React.createElement('button', { className: 'mdv-btn', onClick: function () { setZoom(1); setOffset({ x: 0, y: 0 }); } }, Math.round(zoom * 100) + '%'),
					React.createElement('span', { className: 'mdv-assettname' }, '\uD83D\uDDBC ' + title),
					React.createElement('a', { className: 'mdv-btn', href: url, target: '_blank', rel: 'noreferrer' }, '\u2197 新窗口'),
					React.createElement('a', { className: 'mdv-btn', href: url, download: title }, '\u2B07 下载')),
				React.createElement('div', {
					className: 'mdv-imagestage',
					ref: stageRef,
					onPointerDown: onPointerDown,
					onPointerMove: onPointerMove,
					onPointerUp: onPointerUp,
					onPointerCancel: onPointerUp,
				}, React.createElement('img', {
					className: 'mdv-imagezoom',
					src: url,
					alt: title,
					style: { transform: 'translate(' + offset.x + 'px,' + offset.y + 'px) scale(' + zoom + ')' },
					draggable: false,
				})));
		}

		/**
		 * An asset shown in a full-size <iframe>: shared chrome for the HTML and
		 * spreadsheet viewers, which differ only in icon and sandbox.
		 *
		 * `sandbox` is omitted for the SheetJS page (same-origin, generated by our
		 * own host route, and it must load /mdvault/xlsx.js). The HTML viewer
		 * always sandboxes WITHOUT allow-same-origin, so a previewed page lands in
		 * an opaque origin and cannot reach the GUI's session.
		 */
		function FrameView(props) {
			return React.createElement('div', { className: 'mdv-assetwrap' },
				React.createElement('div', { className: 'mdv-assettbar' },
					React.createElement('span', { className: 'mdv-assettname' }, props.icon + ' ' + props.title),
					React.createElement('a', { className: 'mdv-btn', href: props.url, target: '_blank', rel: 'noreferrer' }, '\u2197 新窗口')),
				React.createElement('iframe', Object.assign({
					key: props.url,
					className: 'mdv-frame mdv-framewhite',
					src: props.url,
					title: props.title,
				}, props.sandbox ? { sandbox: props.sandbox, referrerPolicy: 'no-referrer' } : {})));
		}

		// ── resizable split ────────────────────────────────────────────────────

		/** Bounds and default for the tree column, in px. */
		const SIDE_MIN = 150
		const SIDE_MAX = 760
		const SIDE_DEFAULT = 280
		const SIDE_STORE_KEY = 'dsh-mdvault.sideWidth'

		/**
		 * Read the persisted width. Storage can be unavailable (private mode,
		 * a hardened browser), so every access is guarded and falls back to the
		 * default rather than throwing during render.
		 */
		function loadSideWidth() {
			try {
				const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SIDE_STORE_KEY)
				const n = raw === null ? NaN : Number(raw)
				if (Number.isFinite(n)) return Math.min(SIDE_MAX, Math.max(SIDE_MIN, n))
			} catch (err) { /* unavailable storage is not an error */ }
			return SIDE_DEFAULT
		}

		function saveSideWidth(px) {
			try {
				if (typeof localStorage !== 'undefined') localStorage.setItem(SIDE_STORE_KEY, String(px))
			} catch (err) { /* best effort */ }
		}

		/**
		 * A draggable vertical divider. Returns the current width plus the props
		 * to spread onto the tree column and the handle.
		 *
		 * Pointer capture is used so the drag keeps tracking even when the
		 * pointer leaves the handle — without it the drag stops the moment the
		 * cursor moves one pixel off a 7px strip. `touch-action: none` on the
		 * handle (see CSS) stops the browser turning the gesture into a scroll.
		 *
		 * @param {number} maxWidth - upper bound derived from the container.
		 */
		function useSplitWidth(maxWidth) {
			const state = React.useState(loadSideWidth);
			const width = state[0];
			const setWidth = state[1];
			const draggingState = React.useState(false);
			const dragging = draggingState[0];
			const setDragging = draggingState[1];
			const originRef = React.useRef(null);

			const clamp = React.useCallback(function (px) {
				const upper = Math.max(SIDE_MIN, Math.min(SIDE_MAX, maxWidth || SIDE_MAX));
				return Math.min(upper, Math.max(SIDE_MIN, Math.round(px)));
			}, [maxWidth]);

			const onPointerDown = React.useCallback(function (event) {
				if (event.button !== 0 && event.pointerType === 'mouse') return;
				// Offset of the pointer inside the handle, so grabbing it near an
				// edge does not make the divider jump under the cursor.
				const rect = event.currentTarget.getBoundingClientRect();
				originRef.current = { x: event.clientX, offset: event.clientX - rect.left };
				if (event.currentTarget.setPointerCapture) {
					event.currentTarget.setPointerCapture(event.pointerId);
				}
				setDragging(true);
				event.preventDefault();
			}, []);

			const onPointerMove = React.useCallback(function (event) {
				const origin = originRef.current;
				if (origin === null) return;
				// The handle sits to the RIGHT of the tree, so the new width is
				// how far the pointer has travelled plus where inside the handle
				// it was grabbed.
				setWidth(clamp(width + (event.clientX - origin.x)));
				originRef.current = { x: event.clientX, offset: origin.offset };
			}, [width, clamp, setWidth]);

			const endDrag = React.useCallback(function (event) {
				if (originRef.current === null) return;
				originRef.current = null;
				if (event && event.currentTarget.releasePointerCapture
					&& event.currentTarget.hasPointerCapture
					&& event.currentTarget.hasPointerCapture(event.pointerId)) {
					event.currentTarget.releasePointerCapture(event.pointerId);
				}
				setDragging(false);
				saveSideWidth(width);
			}, [width, setDragging]);

			// Keyboard support: the handle is focusable, so the column is
			// reachable without a pointer.
			const onKeyDown = React.useCallback(function (event) {
				const step = event.shiftKey ? 40 : 10;
				let next = null;
				if (event.key === 'ArrowLeft') next = width - step;
				else if (event.key === 'ArrowRight') next = width + step;
				else if (event.key === 'Home') next = SIDE_MIN;
				else if (event.key === 'End') next = SIDE_MAX;
				if (next === null) return;
				event.preventDefault();
				const value = clamp(next);
				setWidth(value);
				saveSideWidth(value);
			}, [width, clamp, setWidth]);

			const reset = React.useCallback(function () {
				setWidth(SIDE_DEFAULT);
				saveSideWidth(SIDE_DEFAULT);
			}, [setWidth]);

			return {
				width: clamp(width),
				dragging: dragging,
				sideProps: { style: { width: clamp(width) } },
				handleProps: {
					className: 'mdv-split' + (dragging ? ' mdv-dragging' : ''),
					role: 'separator',
					'aria-orientation': 'vertical',
					'aria-label': '调整文件树宽度',
					'aria-valuenow': clamp(width),
					'aria-valuemin': SIDE_MIN,
					'aria-valuemax': SIDE_MAX,
					tabIndex: 0,
					title: '拖动调整宽度，双击恢复默认',
					onPointerDown: onPointerDown,
					onPointerMove: onPointerMove,
					onPointerUp: endDrag,
					onPointerCancel: endDrag,
					onDoubleClick: reset,
					onKeyDown: onKeyDown,
				},
			};
		}

		/** Sandbox tokens for an untrusted HTML preview: no allow-same-origin. */
		const HTML_SANDBOX = 'allow-scripts allow-popups allow-downloads allow-modals';

		function HtmlView(props) {
			return React.createElement(FrameView, {
				url: props.url, title: props.title, icon: '\uD83C\uDF10', sandbox: HTML_SANDBOX,
			});
		}

		/** Spreadsheet preview: the host-generated SheetJS page, same-origin. */
		function SheetView(props) {
			return React.createElement(FrameView, {
				url: props.url, title: props.title, icon: '\uD83D\uDCD7',
			});
		}

		/** A fence long enough to contain `content` verbatim. */
		function fenceFor(content) {
			let longest = 0;
			const runs = String(content).match(/`+/g);
			if (runs) for (const run of runs) longest = Math.max(longest, run.length);
			return new Array(Math.max(3, longest + 1) + 1).join('`');
		}

		/**
		 * Fence info string per file extension, for the read-only code viewer.
		 * Hoisted: as a function-local literal this map was rebuilt on every
		 * call, i.e. on every render of every code document.
		 */
		const LANG_BY_EXT = {
			js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
			ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
			py: 'python', pyi: 'python', rb: 'ruby', go: 'go', rs: 'rust',
			java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', swift: 'swift',
			dart: 'dart', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp',
			hpp: 'cpp', hh: 'cpp', hxx: 'cpp', cs: 'csharp', php: 'php',
			sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
			ps1: 'powershell', psm1: 'powershell', bat: 'bat', cmd: 'bat',
			sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini',
			json: 'json', json5: 'json', jsonc: 'json', ndjson: 'json',
			xml: 'xml', html: 'html', htm: 'html', css: 'css', scss: 'scss',
			sass: 'sass', less: 'less', vue: 'vue', svelte: 'svelte',
			md: 'markdown', markdown: 'markdown', mdx: 'markdown',
			lua: 'lua', pl: 'perl', pm: 'perl', r: 'r', jl: 'julia',
			graphql: 'graphql', gql: 'graphql', proto: 'protobuf',
			diff: 'diff', patch: 'diff', tex: 'latex', dockerfile: 'dockerfile',
			makefile: 'makefile', cmake: 'cmake', gradle: 'groovy',
		};

		/** The extension of a path or bare name, lowercased ('' when none). */
		function extOf(path) {
			const name = String(path == null ? '' : path).toLowerCase();
			const dot = name.lastIndexOf('.');
			const slash = name.lastIndexOf('/');
			return dot > slash ? name.slice(dot + 1) : name;
		}

		/** Language hint for a fenced block, from the file extension. */
		function langForPath(path) {
			return LANG_BY_EXT[extOf(path)] || '';
		}

		/**
		 * Size tiers for the read-only code viewer. Syntax highlighting runs
		 * the whole document through the platform's markdown pipeline, which is
		 * quadratic-ish on big inputs — rendering a bundled/minified multi-MB
		 * `.js` (or a large log) that way freezes the tab. Render those plainly
		 * instead, and refuse the truly huge ones outright.
		 */
		const HIGHLIGHT_MAX = 200 * 1024
		const PLAIN_MAX = 2 * 1024 * 1024

		/**
		 * Load a text file through the JSON API, as a {status, text|message}
		 * state machine. Shared by the main document pane and the read-only view
		 * for a file reached by link, which previously each carried their own
		 * copy of this effect. `tick` forces a refetch (the toolbar's 刷新).
		 *
		 * @returns {{status: 'loading'|'ready'|'error', text?: string, message?: string}|null}
		 *   null when there is nothing to load.
		 */
		function useTextFile(sessionId, path, tick) {
			const state = React.useState(null);
			const load = state[0];
			const setLoad = state[1];

			React.useEffect(function () {
				if (!path) { setLoad(null); return; }
				let alive = true;
				setLoad({ status: 'loading' });
				api('read', { sessionId: sessionId, path: path }).then(function (res) {
					if (!alive) return;
					if (res && res.ok) setLoad({ status: 'ready', text: typeof res.text === 'string' ? res.text : '' });
					else setLoad({ status: 'error', message: (res && res.error) || '读取失败' });
				});
				return function () { alive = false; };
			}, [sessionId, path, tick]);

			return load;
		}

		/**
		 * Read-only view of a text file reached by a link rather than the tree
		 * (so it has no writable selection). Renders with CodeView, keeping the
		 * same size tiers.
		 */
		function TreeTextView(props) {
			const load = useTextFile(props.nav.sessionId, props.rel, 0);
			if (load === null || load.status === 'loading') {
				return React.createElement('div', { className: 'mdv-empty' }, '正在读取 ' + props.rel + ' …');
			}
			if (load.status === 'error') {
				return React.createElement('div', { className: 'mdv-empty' }, '\u26A0\uFE0F ' + load.message);
			}
			return React.createElement(CodeView, {
				text: load.text,
				path: props.rel,
				nav: props.nav,
				downloadUrl: props.url,
			});
		}

		/** Human-readable byte size for viewer chrome. */
		function formatBytes(n) {
			const v = Number(n) || 0;
			if (v < 1024) return v + ' B';
			if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + ' KB';
			return (v / 1048576).toFixed(1) + ' MB';
		}

		/** Read-only text/code viewer: highlighted when small enough to be cheap. */
		function CodeView(props) {
			const content = props.text;
			const lang = langForPath(props.path);
			const tooBigToRender = content.length > PLAIN_MAX;
			const highlight = !tooBigToRender && content.length <= HIGHLIGHT_MAX;

			const fenced = React.useMemo(function () {
				if (!highlight) return null;
				const fence = fenceFor(content);
				return fence + (lang || '') + '\n' + content + '\n' + fence;
			}, [content, highlight, lang]);

			const stats = React.useMemo(function () {
				let lines = 1;
				for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) lines++;
				return lines + ' 行 · ' + formatBytes(content.length) + (tooBigToRender ? ' · 过大，已停止渲染' : highlight ? '' : ' · 纯文本（未高亮）');
			}, [content, highlight, tooBigToRender]);

			const header = React.createElement('div', { className: 'mdv-docbar' },
				React.createElement('span', { className: 'mdv-docpath' }, props.path),
				React.createElement('span', { className: 'mdv-meta' }, stats),
				React.createElement('a', { className: 'mdv-btn', href: props.downloadUrl, target: '_blank', rel: 'noreferrer' }, '\u2197 新窗口'),
				props.downloadUrl ? React.createElement('a', { className: 'mdv-btn', href: props.downloadUrl, download: '' }, '\u2B07 下载') : null);

			if (tooBigToRender) {
				return React.createElement('div', null, header,
					React.createElement('div', { className: 'mdv-notice' },
						React.createElement('div', null,
							'\u26A0\uFE0F 文件过大（' + formatBytes(content.length) + '），为避免卡顿没有直接渲染。'),
						React.createElement('div', { className: 'mdv-meta' },
							'打开方式：点「新窗口」在浏览器里查看，或下载后用本地编辑器打开。')));
			}
			if (!highlight) {
				return React.createElement('div', null, header,
					React.createElement('pre', { className: 'mdv-plain' }, content));
			}
			return React.createElement('div', null, header,
				React.createElement(MarkdownViewMemo, { text: fenced, nav: props.nav }));
		}

		// ── editor ────────────────────────────────────────────────────────────

		/**
		 * Text editor: line-number gutter, dirty tracking, Ctrl/Cmd+S save, and
		 * an in-document find/replace bar. A plain <textarea> keeps the plugin
		 * build-free; the gutter is a synced <pre> column.
		 */
		function Editor(props) {
			const value = props.value;
			const onChange = props.onChange;
			const onSave = props.onSave;
			const saving = props.saving;
			const saveErr = props.saveErr;
			const dirty = props.dirty;
			const onCancel = props.onCancel;
			const areaRef = React.useRef(null);
			const gutterRef = React.useRef(null);
			const barState = React.useState(false);
			const barOpen = barState[0];
			const setBarOpen = barState[1];
			const qState = React.useState('');
			const query = qState[0];
			const setQuery = qState[1];
			const rState = React.useState('');
			const replacement = rState[0];
			const setReplacement = rState[1];
			const idxState = React.useState(0);
			const activeIndex = idxState[0];
			const setActiveIndex = idxState[1];

			const lines = React.useMemo(function () { return value.split('\n').length; }, [value]);

			// The gutter text is derived from the line count alone. Built during
			// render it would reallocate a string proportional to the file on
			// every keystroke.
			const gutterText = React.useMemo(function () {
				const out = new Array(lines);
				for (let n = 1; n <= lines; n++) out[n - 1] = n;
				return out.join('\n');
			}, [lines]);

			const matches = React.useMemo(function () {
				if (!query) return [];
				const out = [];
				const hay = value.toLowerCase();
				const needle = query.toLowerCase();
				let from = 0;
				for (;;) {
					const at = hay.indexOf(needle, from);
					if (at < 0) break;
					out.push(at);
					from = at + Math.max(1, needle.length);
					if (out.length > 5000) break;
				}
				return out;
			}, [value, query]);

			function selectMatch(index) {
				const area = areaRef.current;
				if (!area || !matches.length) return;
				const pos = matches[((index % matches.length) + matches.length) % matches.length];
				area.focus();
				area.setSelectionRange(pos, pos + query.length);
				// Scroll the match to roughly the middle of the viewport.
				const before = value.slice(0, pos).split('\n').length - 1;
				const lineHeight = 21;
				area.scrollTop = Math.max(0, before * lineHeight - area.clientHeight / 2);
				setActiveIndex(((index % matches.length) + matches.length) % matches.length);
			}

			function onKeyDown(event) {
				const mod = event.ctrlKey || event.metaKey;
				if (mod && (event.key === 's' || event.key === 'S')) { event.preventDefault(); onSave(); return; }
				if (mod && (event.key === 'f' || event.key === 'F')) { event.preventDefault(); setBarOpen(true); return; }
				if (event.key === 'Escape') {
					if (barOpen) { setBarOpen(false); event.preventDefault(); }
					else onCancel();
					return;
				}
				if (barOpen && event.key === 'Enter') {
					event.preventDefault();
					selectMatch(activeIndex + (event.shiftKey ? -1 : 1));
					return;
				}
				if (event.key === 'Tab') {
					event.preventDefault();
					const area = event.currentTarget;
					const start = area.selectionStart;
					const end = area.selectionEnd;
					const next = value.slice(0, start) + '  ' + value.slice(end);
					onChange(next);
					if (typeof requestAnimationFrame === 'function') {
						requestAnimationFrame(function () { area.setSelectionRange(start + 2, start + 2); });
					}
				}
			}

			function replaceCurrent() {
				if (!matches.length) return;
				const pos = matches[activeIndex % matches.length];
				const next = value.slice(0, pos) + replacement + value.slice(pos + query.length);
				onChange(next);
			}

			function replaceAll() {
				if (!query) return;
				const re = new RegExp(escRe(query), 'gi');
				onChange(value.replace(re, replacement));
			}

			const findBar = barOpen ? React.createElement('div', { className: 'mdv-findbar' },
				React.createElement('input', {
					className: 'mdv-input', placeholder: '查找…', value: query, autoFocus: true,
					onChange: function (e) { setQuery(e.target.value); setActiveIndex(0); },
					onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); selectMatch(activeIndex + (e.shiftKey ? -1 : 1)); } },
				}),
				React.createElement('span', { className: 'mdv-meta' }, query ? (matches.length ? (activeIndex + 1) + '/' + matches.length : '0/0') : ''),
				React.createElement('input', {
					className: 'mdv-input', placeholder: '替换为…', value: replacement,
					onChange: function (e) { setReplacement(e.target.value); },
				}),
				React.createElement('button', { className: 'mdv-btn', disabled: !matches.length, onClick: function () { selectMatch(activeIndex + 1); } }, '\u2193 下一个'),
				React.createElement('button', { className: 'mdv-btn', disabled: !matches.length, onClick: replaceCurrent }, '替换'),
				React.createElement('button', { className: 'mdv-btn', disabled: !query, onClick: replaceAll }, '全部替换'),
				React.createElement('button', { className: 'mdv-btn', onClick: function () { setBarOpen(false); } }, '\u2715'),
			) : null;

			return React.createElement('div', { className: 'mdv-editorwrap' },
				React.createElement('div', { className: 'mdv-docbar' },
					React.createElement('span', { className: 'mdv-docpath', title: props.path },
						'\u270D ' + props.path + (dirty ? ' •' : '')),
					React.createElement('span', { className: 'mdv-meta' }, lines + ' 行'),
					saveErr ? React.createElement('span', { className: 'mdv-saveerr' }, '\u26A0 ' + saveErr) : null,
					React.createElement('button', { className: 'mdv-btn', onClick: function () { setBarOpen(!barOpen); } }, '\uD83D\uDD0D 查找'),
					React.createElement('button', { className: 'mdv-btn primary', disabled: saving, onClick: onSave },
						saving ? '保存中…' : '\uD83D\uDDBE 保存 (Ctrl+S)'),
					React.createElement('button', { className: 'mdv-btn', onClick: onCancel }, '取消')),
				findBar,
				React.createElement('div', { className: 'mdv-editbody' },
					React.createElement('pre', { className: 'mdv-gutter', ref: gutterRef, 'aria-hidden': 'true' },
						React.createElement('code', null, gutterText)),
					React.createElement('textarea', {
						className: 'mdv-editor',
						ref: areaRef,
						value: value,
						spellCheck: false,
						onChange: function (e) { onChange(e.target.value); },
						onKeyDown: onKeyDown,
						onScroll: function (e) {
							if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
						},
					})));
		}

		// ── better-sidebar integration (optional, mounted only when present) ──

		function mountSidebar(ctx) {
			const sidebar = ctx.get('betterSidebar');
			if (sidebar === undefined || typeof sidebar.registerFileViewer !== 'function' || typeof sidebar.registerTab !== 'function') return;

			function sbResolveAbs(t, basePath, rootDir) {
				let r = String(t || '').trim().replace(/\\/g, '/');
				if (!r) return null;
				r = r.replace(/^\.\//, '');
				if (r.charAt(0) === '/') return null;
				const segs = r.split('/');
				for (const s of segs) { if (s === '..' || (s.charAt(0) === '.' && s !== '.')) return null; }
				const base = segs.length === 1 ? basePath.split('/').slice(0, -1).join('/') : rootDir;
				if (!base) return null;
				return base + '/' + r;
			}

			function sbMediaUrl(sid, abs, frag) {
				return '/sidebar/file?sessionId=' + encodeURIComponent(sid) + '&path=' + encodeURIComponent(abs) + (frag ? '#' + frag : '');
			}

			function SidebarDocView(props) {
				const content = props && typeof props.content === 'string' ? props.content : '';
				const scope = (props && props.scope) || {};
				const sid = typeof scope.sessionId === 'string' ? scope.sessionId : '';
				const basePath = props && typeof props.path === 'string' ? props.path.replace(/\\/g, '/') : '';
				const rootDir = typeof scope.cwd === 'string' && scope.cwd ? scope.cwd.replace(/\\/g, '/') : basePath.split('/').slice(0, -1).join('/');
				const rootRef = React.useRef(null);
				const nav = {
					sessionId: sid,
					currentPath: basePath,
					openFile: function (target) {
						let t = String(target || '').trim().replace(/\\/g, '/');
						if (!t) return false;
						let frag = '';
						const hi = t.indexOf('#');
						if (hi >= 0) { frag = t.slice(hi + 1); t = t.slice(0, hi); }
						if (!t) return false;
						const abs = sbResolveAbs(t, basePath, rootDir);
						if (!abs) return false;
						try {
							if (PDF_RE.test(t)) {
								sidebar.openTab({
									type: 'mdvault-pdf',
									id: 'mdvault-pdf:' + abs + '#' + frag,
									title: t.split('/').pop(),
									path: sbMediaUrl(sid, abs, frag),
								});
								return true;
							}
							sidebar.openTab({ type: 'editor', path: abs });
							return true;
						} catch (err) {
							console.error('[dsh-mdvault] sidebar open failed:', err);
							return false;
						}
					},
					assetUrl: function (href) {
						const h = String(href || '').trim();
						if (!h || /^https?:\/\//i.test(h) || h.charAt(0) === '#') return '';
						const clean = h.split('#')[0];
						if (!IMAGE_RE.test(clean)) return '';
						if (!sid) return '';
						const abs = sbResolveAbs(clean, basePath, rootDir);
						if (!abs) return '';
						return sbMediaUrl(sid, abs, '');
					},
				};
				React.useEffect(function () {
					const el = rootRef.current;
					if (el === null) return;
					navByRoot.set(el, nav);
					return function () { navByRoot.delete(el) };
					// eslint-disable-next-line react-hooks/exhaustive-deps
				}, [sid, basePath]);
				return React.createElement('div', { className: 'mdv-main mdv-sbdoc', 'data-mdv-root': '', ref: rootRef },
					React.createElement(MarkdownViewMemo, { text: content, nav: nav }));
			}

			ctx.effect(function () {
				const d1 = sidebar.registerFileViewer({
					id: 'mdvault-markdown',
					title: 'MD 双链视图 (mdvault)',
					exts: ['md', 'markdown'],
					priority: 10,
					fetchStrategy: 'fsRead',
					component: function (props) { return React.createElement(SidebarDocView, props); },
				});
				const d2 = sidebar.registerTab({
					id: 'mdvault-pdf',
					title: 'PDF 跳页预览',
					hidden: true,
					component: function (props) {
						const tab = props && props.tab;
						const src = tab && typeof tab.path === 'string' ? tab.path : '';
						if (!src) return React.createElement('div', { className: 'mdv-empty' }, '缺少文件地址');
						return React.createElement('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } },
							React.createElement('iframe', { key: src, src: src, className: 'mdv-frame', title: 'PDF 预览' }));
					},
				});
				return function () { d1(); d2(); };
			}, 'dsh-mdvault: better-sidebar integration');
		}

		// ── main view ──────────────────────────────────────────────────────────

		function MdVaultView(props) {
			const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : '';
			const filesState = React.useState(null);
			const files = filesState[0];
			const setFiles = filesState[1];
			const rootState = React.useState('');
			const rootPath = rootState[0];
			const setRootPath = rootState[1];
			const errState = React.useState('');
			const listErr = errState[0];
			const setListErr = errState[1];
			const truncState = React.useState(false);
			const listTruncated = truncState[0];
			const setListTruncated = truncState[1];
			// Whether the shown root is this session's own directory, or a
			// deployment fallback because it could not be determined.
			const rootOkState = React.useState(true);
			const rootResolved = rootOkState[0];
			const setRootResolved = rootOkState[1];
			// The composer is hidden by default: this view is for reading, and
			// the input box claims a large slice of the window for no benefit.
			const composerState = React.useState(true);
			const composerHidden = composerState[0];
			const setComposerHidden = composerState[1];
			const tickState = React.useState(0);
			const tick = tickState[0];
			const setTick = tickState[1];
			const selState = React.useState('');
			const selected = selState[0];
			const setSelected = selState[1];
			const docState = React.useState(null);
			const doc = docState[0];
			const setDoc = docState[1];
			const colState = React.useState({});
			const collapsed = colState[0];
			const setCollapsed = colState[1];
			const assetState = React.useState(null);
			const asset = assetState[0];
			const setAsset = assetState[1];
			const editState = React.useState(false);
			const editing = editState[0];
			const setEditing = editState[1];
			const draftState = React.useState('');
			const draft = draftState[0];
			const setDraft = draftState[1];
			const savingState = React.useState(false);
			const saving = savingState[0];
			const setSaving = savingState[1];
			const saveErrState = React.useState('');
			const saveErr = saveErrState[0];
			const setSaveErr = saveErrState[1];
			const filterState = React.useState('');
			const filter = filterState[0];
			const setFilter = filterState[1];

			React.useEffect(function () {
				let alive = true;
				setListErr('');
				api('list', { sessionId: sessionId }).then(function (res) {
					if (!alive) return;
					if (res && res.ok) {
						const list = Array.isArray(res.files) ? res.files : [];
						setFiles(list);
						setRootPath(typeof res.root === 'string' ? res.root : '');
						setListTruncated(res.truncated === true);
						// `resolved === false` means the host could not determine
						// this session's own directory and fell back to the
						// deployment default. Say so, rather than presenting an
						// unrelated directory as if it were the project.
						setRootResolved(res.resolved !== false);
						if (list.length) {
							let pick = null;
							for (const f of list) { if (/^readme\.md$/i.test(f.name)) { pick = f; break; } }
							if (!pick) { for (const f of list) { if (MD_RE.test(f.name)) { pick = f; break; } } }
							if (pick) setSelected(function (prev) { return prev || pick.path; });
						}
					} else {
						setListErr((res && res.error) || '加载文件列表失败');
					}
				});
				return function () { alive = false; };
			}, [sessionId, tick]);

			// Text-ish files are read through the API; images/PDF/HTML are
			// rendered straight from the asset route.
			const selectedIsText = isTextDoc(selected);

			// A text document loads through the shared hook; the loaded text is
			// mirrored into `doc` state so a save can update it optimistically
			// without a refetch.
			const textLoad = useTextFile(sessionId, selectedIsText ? selected : '', tick);
			const docErr = textLoad !== null && textLoad.status === 'error' ? textLoad.message : '';
			React.useEffect(function () {
				setEditing(false);
				setSaveErr('');
				if (textLoad !== null && textLoad.status === 'ready') {
					setDoc({ path: selected, text: textLoad.text });
				} else if (textLoad === null || textLoad.status === 'error') {
					setDoc(null);
				}
				// `setDoc`/`setEditing` are stable; `selected` and `textLoad` are
				// the real inputs.
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [textLoad, selected]);

			const fileList = files || [];
			const dirty = doc !== null && editing && draft !== doc.text;

			function leaveEdit() {
				if (dirty && typeof window !== 'undefined' && !window.confirm('放弃未保存的修改？')) return;
				setEditing(false);
				setSaveErr('');
			}

			function saveDraft() {
				if (!doc || !editing || saving) return;
				setSaving(true);
				api('write', { sessionId: sessionId, path: doc.path, text: draft }).then(function (res) {
					setSaving(false);
					if (res && res.ok) {
						setDoc({ path: doc.path, text: draft });
						setEditing(false);
						setSaveErr('');
					} else {
						setSaveErr((res && res.error) || '保存失败');
					}
				});
			}

			function findByPath(p) {
				return findByPathIn(fileList, p);
			}

			/**
			 * Open an intercepted link target. `kind` is 'wiki' for
			 * `[[wikilinks]]` and 'rel' for ordinary markdown links; the two
			 * dialects resolve differently (see resolveOpenTarget).
			 *
			 * Three outcomes, in order of preference: the editable document in
			 * the tree (when the tree lists it), the SheetJS page, or the raw
			 * asset route. The asset kind is the target kind, except that an
			 * unrenderable binary becomes a download prompt.
			 */
			function openFileImpl(rawTarget, kind) {
				const target = resolveOpenTarget(rawTarget, selected, kind, fileList);
				if (!target) return false;
				const name = target.rel.split('/').pop();

				// Notes and text open as the editable document — the tree must
				// list them to have a writable selection. A file outside the
				// listing (too deep, or past the cap) still opens, read-only.
				if (target.kind === 'note' || target.kind === 'text') {
					const hit = findByPath(target.rel);
					if (hit) { setAsset(null); setEditing(false); setSelected(hit.path); return true; }
					setAsset(target.kind === 'text'
						? { kind: 'text', name: name, rel: target.rel, url: assetUrlFor(sessionId, target.rel, '') }
						: { kind: 'download', name: name, url: assetUrlFor(sessionId, target.rel, '') });
					return true;
				}
				if (target.kind === 'sheet') {
					setAsset({ kind: 'sheet', name: name, url: sheetUrlFor(sessionId, target.rel) });
					return true;
				}
				// Only the PDF keeps a #page fragment.
				const frag = target.kind === 'pdf' ? target.frag : '';
				setAsset({
					kind: target.kind === 'file' ? 'download' : target.kind,
					name: name,
					url: assetUrlFor(sessionId, target.rel, frag),
					frag: frag,
				});
				return true;
			}

			/**
			 * Open an asset by its WORKSPACE-RELATIVE path, for a tree row.
			 *
			 * This must NOT go through link resolution. A tree row's path is
			 * already authoritative and workspace-root-relative, whereas
			 * openFileImpl resolves a target relative to the OPEN DOCUMENT —
			 * correct for a link written inside that document, and wrong for a
			 * tree click.
			 *
			 * Routing tree clicks through link resolution meant that clicking a
			 * root-level file while a document in a subdirectory was open
			 * resolved the path INTO that subdirectory, so the file 404ed. The
			 * bug stayed hidden in most workspaces because they keep a README at
			 * the root: with the open document at the root the base directory is
			 * '', and the two resolutions happen to agree.
			 */
			function openTreeAsset(rel) {
				const name = rel.split('/').pop();
				const kind = viewerKindFor(name);
				if (kind === 'sheet') {
					setAsset({ kind: 'sheet', name: name, url: sheetUrlFor(sessionId, rel) });
					return;
				}
				setAsset({
					kind: kind === 'file' ? 'download' : kind,
					name: name,
					url: assetUrlFor(sessionId, rel, ''),
					frag: '',
				});
			}

			function openFromTree(f) {
				if (!f) return;
				if (isTextDoc(f.name)) {
					setAsset(null);
					setEditing(false);
					setSelected(f.path);
					return;
				}
				openTreeAsset(f.path);
			}

			function assetUrlImpl(href) {
				const h = String(href || '').trim();
				if (!h || /^https?:\/\//i.test(h) || h.charAt(0) === '#') return '';
				const clean = h.split('#')[0];
				if (!IMAGE_RE.test(clean)) return '';
				// Resolve against the linking document, like MarkdownView's
				// pathImages hook does — the two must agree.
				const rel = toRelPath(clean, selected);
				if (!rel) return '';
				return assetUrlFor(sessionId, rel, '');
			}

			// `nav` keeps a STABLE identity across renders. MarkdownView and the
			// platform MarkdownText are memoized on their props, so handing them
			// a fresh object every render would re-run the whole O(document)
			// markdown pipeline on every tree-filter keystroke and selection
			// change — the main source of the sluggishness.
			const navImpl = React.useRef(null);
			navImpl.current = {
				sessionId: sessionId,
				currentPath: selected,
				openFile: openFileImpl,
				assetUrl: assetUrlImpl,
			};
			const nav = React.useMemo(function () {
				return {
					get sessionId() { return navImpl.current.sessionId; },
					get currentPath() { return navImpl.current.currentPath; },
					openFile: function (target, kind) { return navImpl.current.openFile(target, kind); },
					assetUrl: function (href) { return navImpl.current.assetUrl(href); },
				};
			}, []);

			function toggleDir(path, open) {
				setCollapsed(function (prev) {
					const next = Object.assign({}, prev);
					next[path] = open;
					return next;
				});
			}

			// Resizable tree column. The upper bound is derived from the actual
			// container so the document pane can never be squeezed out of
			// existence on a narrow window.
			const bodyRef = React.useRef(null);
			const boardState = React.useState(900);
			const bodyWidth = boardState[0];
			const setBodyWidth = boardState[1];
			React.useEffect(function () {
				const el = bodyRef.current;
				if (el === null || typeof ResizeObserver === 'undefined') return;
				const observer = new ResizeObserver(function (entries) {
					const w = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0;
					if (w > 0) setBodyWidth(w);
				});
				observer.observe(el);
				return function () { observer.disconnect(); };
			}, []);
			const split = useSplitWidth(Math.max(SIDE_MIN, bodyWidth - 260));

			// Line count for the doc bar: computed once per document instead of
			// re-splitting the whole text on every render.
			//
			// MUST be declared before `mainContent` is built: it is a `const`
			// read further down, so hoisting it below the read is a
			// temporal-dead-zone ReferenceError thrown during render — which
			// unmounts the whole tab and leaves a blank page.
			const codeStats = React.useMemo(function () {
				if (!doc) return '';
				let lines = 1;
				for (let i = 0; i < doc.text.length; i++) if (doc.text.charCodeAt(i) === 10) lines++;
				return lines + ' 行';
			}, [doc]);

			// Publish this instance's nav so the document-level click handler can
			// route an intercepted link to the container it was clicked in.
			const rootRef = React.useRef(null);
			React.useEffect(function () {
				const el = rootRef.current;
				if (el === null) return;
				navByRoot.set(el, nav);
				return function () { navByRoot.delete(el) };
			}, [nav]);

			// Hide the bottom composer while this view is on screen (the view
			// only mounts while it is the ACTIVE conversation view, so the
			// composer comes back automatically on switching to 对话). The
			// toggle in the toolbar restores it on demand — useful for typing a
			// follow-up while reading a document.
			React.useEffect(function () {
				if (typeof document === 'undefined' || !document.body) return;
				if (!composerHidden) return;
				document.body.setAttribute(COMPOSER_HIDE_ATTR, '');
				return function () { document.body.removeAttribute(COMPOSER_HIDE_ATTR) };
			}, [composerHidden]);

			let mainContent;
			if (asset) {
				const back = React.createElement('button', { className: 'mdv-btn', onClick: function () { setAsset(null); } }, '\u2190 返回文档');
				if (asset.kind === 'pdf') {
					mainContent = React.createElement('div', null, React.createElement('div', { className: 'mdv-docbar' }, back),
						React.createElement(PdfView, { url: asset.url, title: asset.name, frag: asset.frag }));
				} else if (asset.kind === 'image') {
					mainContent = React.createElement('div', null, React.createElement('div', { className: 'mdv-docbar' }, back),
						React.createElement(ImageView, { url: asset.url, title: asset.name }));
				} else if (asset.kind === 'html') {
					mainContent = React.createElement('div', null, React.createElement('div', { className: 'mdv-docbar' }, back),
						React.createElement(HtmlView, { url: asset.url, title: asset.name }));
				} else if (asset.kind === 'sheet') {
					mainContent = React.createElement('div', null, React.createElement('div', { className: 'mdv-docbar' }, back),
						React.createElement(SheetView, { url: asset.url, title: asset.name }));
				} else if (asset.kind === 'text') {
					mainContent = React.createElement('div', null, React.createElement('div', { className: 'mdv-docbar' }, back),
						React.createElement(TreeTextView, { url: asset.url, name: asset.name, rel: asset.rel, nav: nav }));
				} else {
					mainContent = React.createElement('div', { className: 'mdv-assetwrap' },
						React.createElement('div', { className: 'mdv-assettbar' }, back,
							React.createElement('span', { className: 'mdv-assettname', title: asset.name }, '\uD83D\uDCC4 ' + asset.name)),
						React.createElement('div', { className: 'mdv-notice' },
							React.createElement('div', null, '\u26A0\uFE0F 浏览器无法内嵌预览「' + asset.name + '」这个格式'),
							asset.url ? React.createElement('a', { className: 'mdv-dl', href: asset.url, download: asset.name }, '\u2B07 下载文件') : null));
				}
			} else if (docErr) {
				mainContent = React.createElement('div', { className: 'mdv-empty' }, '\u26A0\uFE0F ' + docErr);
			} else if (!selected) {
				mainContent = React.createElement('div', { className: 'mdv-empty' }, '从左侧选择一个文件开始预览');
			} else if (!selectedIsText) {
				mainContent = React.createElement('div', { className: 'mdv-empty' }, '正在打开 ' + selected + ' …');
			} else if (!doc) {
				mainContent = React.createElement('div', { className: 'mdv-empty' }, '正在读取 ' + selected + ' …');
			} else if (editing) {
				mainContent = React.createElement(Editor, {
					path: doc.path,
					value: draft,
					onChange: setDraft,
					onSave: saveDraft,
					onCancel: leaveEdit,
					saving: saving,
					saveErr: saveErr,
					dirty: dirty,
				});
			} else {
				const isCode = !MD_RE.test(doc.path);
				mainContent = React.createElement('div', null,
					React.createElement('div', { className: 'mdv-docbar' },
						React.createElement('span', { className: 'mdv-docpath', title: doc.path }, doc.path),
						React.createElement('span', { className: 'mdv-meta' }, codeStats),
						React.createElement('button', { className: 'mdv-btn', onClick: function () { setDraft(doc.text); setSaveErr(''); setEditing(true); } }, '\u270F\uFE0F 编辑')),
					isCode
						? React.createElement(CodeView, { text: doc.text, path: doc.path, nav: nav, downloadUrl: assetUrlFor(sessionId, doc.path, '') })
						: React.createElement(MarkdownViewMemo, { text: doc.text, nav: nav }));
			}

			return React.createElement('div', { className: 'mdv-root', 'data-mdv-root': '', ref: rootRef },
				React.createElement('div', { className: 'mdv-toolbar' },
					React.createElement('span', { className: 'mdv-title' }, '\uD83D\uDCC4 文档'),
					React.createElement('span', { className: 'mdv-sub', title: rootPath },
						(fileList.length ? fileList.length + ' 个可预览文件 · ' : '') + rootPath),
					listTruncated
						? React.createElement('span', { className: 'mdv-warn', title: '目录层级或文件数达到上限，部分文件未列出' }, '\u26A0 列表已截断')
						: null,
					!rootResolved
						? React.createElement('span', {
							className: 'mdv-warn',
							title: '无法确定该会话的工作目录，当前显示的是部署默认目录。'
								+ '历史会话可能需要重新打开一次，或该会话的持久化记录不可读。',
						}, '\u26A0 非本会话目录')
						: null,
					React.createElement('button', {
						className: 'mdv-btn',
						title: '折叠所有目录',
						onClick: function () {
							// Mark every known directory explicitly closed. An explicit
							// entry wins over the "open the selected document's path"
							// default, so this also stops a deep current document from
							// springing its folders back open.
							const next = {};
							for (const f of fileList) {
								const segs = f.path.split('/');
								for (let d = 1; d < segs.length; d++) next[segs.slice(0, d).join('/')] = false;
							}
							setCollapsed(next);
						},
					}, '\u229F 折叠'),
					React.createElement('button', { className: 'mdv-btn', onClick: function () { setTick(tick + 1); } }, '\u21BB 刷新'),
					React.createElement('button', {
						className: 'mdv-btn' + (composerHidden ? '' : ' on'),
						title: composerHidden ? '显示底部输入框' : '隐藏底部输入框（阅读时更宽敞）',
						onClick: function () { setComposerHidden(!composerHidden); },
					}, '\u2328 输入框'),
					React.createElement('span', { className: 'mdv-ver', title: 'dsh-mdvault 构建版本（浏览器实际运行的版本）' }, 'v' + MDVAULT_VERSION)),
				React.createElement('div', { className: 'mdv-body', ref: bodyRef },
					React.createElement('div', Object.assign({ className: 'mdv-side' }, split.sideProps),
						React.createElement('input', {
							className: 'mdv-input mdv-filter',
							placeholder: '筛选文件…',
							value: filter,
							onChange: function (e) { setFilter(e.target.value); },
						}),
						React.createElement(FileTree, {
							files: files,
							error: listErr,
							filter: filter,
							selected: selected,
							collapsed: collapsed,
							onToggleDir: toggleDir,
							onSelect: openFromTree,
						})),
					React.createElement('div', split.handleProps),
					React.createElement('div', { className: 'mdv-main' }, mainContent)),
			);
		}

		/**
		 * `slots` is a HARD dependency: the 文档 view tab is the entire point of
		 * this plugin. Declaring it makes Cordis hold this plugin `pending`
		 * until the slot registry is provided, then activate it.
		 *
		 * This declaration is load-bearing, not decorative. DSH's web boot
		 * creates every plugin entry concurrently (`Promise.all` over the
		 * manifest), so a plugin that reaches for `ctx.get('slots')` without
		 * declaring it races the renderer plugin that provides the service.
		 * Losing that race is silent: the lookup returns undefined and the
		 * plugin registers nothing while still reporting as active. That is
		 * exactly how the 文档 tab went missing.
		 */
		const inject = ['slots'];

		function apply(ctx) {
			insertStyles(CSS);

			// One document-level capture listener for the whole plugin: internal
			// link interception must not depend on any component's lifetime.
			ctx.effect(function () {
				document.addEventListener('click', onDocumentClick, true);
				return function () { document.removeEventListener('click', onDocumentClick, true) };
			}, 'dsh-mdvault: internal link interception');

			// betterSidebar is OPTIONAL, so it must NOT be declared in `inject`:
			// doing so would leave this plugin permanently pending on every
			// deployment without dsh-better-sidebar. The scoped `ctx.inject` form
			// runs the callback whenever the service shows up, without blocking
			// this plugin's own activation.
			ctx.inject(['betterSidebar'], function (bctx) { mountSidebar(bctx); });

			const slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined;
			const registry = slots !== undefined ? slots : ctx.slots;
			if (registry === undefined || typeof registry.inject !== 'function') {
				// Never fail silently again: this is the exact condition that hid
				// the tab before the `inject` declaration was added.
				console.warn('[dsh-mdvault] the slots service is unavailable, so the 文档 tab was not registered');
				return;
			}
			const registerView = function () {
				return registry.inject('conversation.view', function () {
					return registry.register(
						{ name: 'conversation.view', id: 'mdvault', order: 30, label: '文档' },
						function (props) { return React.createElement(MdVaultView, props); },
					);
				});
			};
			if (typeof ctx.effect === 'function') ctx.effect(registerView, 'dsh-mdvault: 文档 view');
			else registerView();
		}

		exports.name = 'dsh-mdvault';
		exports.inject = inject;
		exports.apply = apply;
		// Pure helpers, exposed for offline testing (`node test/helpers.test.mjs`).
		// Not part of the integration surface: nothing else consumes this.
		exports.__pure = {
			rewriteInternalLinks: rewriteInternalLinks,
			stripFrontmatter: stripFrontmatter,
			toRelPath: toRelPath,
			fenceFor: fenceFor,
			langForPath: langForPath,
			isTextDoc: isTextDoc,
			isDirOpen: isDirOpen,
			classifyInternalLink: classifyInternalLink,
			parseUrl: parseUrl,
			anchorFromEvent: anchorFromEvent,
			resolveRelPath: resolveRelPath,
			resolveOpenTarget: resolveOpenTarget,
			findByPathIn: findByPathIn,
			formatBytes: formatBytes,
			decodeTarget: decodeTarget,
			hasMermaidFence: hasMermaidFence,
			sanitizeSvg: sanitizeSvg,
			isStrippedSvgElement: isStrippedSvgElement,
			isStrippedSvgAttr: isStrippedSvgAttr,
			WIKI_PREFIX: WIKI_PREFIX,
			REL_PREFIX: REL_PREFIX,
			version: MDVAULT_VERSION,
			MarkdownTextAvailable: MarkdownText !== null,
		};
		return exports;
	},
});
