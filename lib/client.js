/* eslint-disable */
// dsh-mdvault browser half: the conversation "文档" tab plus an optional
// better-sidebar viewer integration. Loaded through the DSH client module
// loader; requires only `react` at runtime.
window.__ModuleLoader__.load({
	id: 'dsh-mdvault',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		const React = require('react');

		const ASSET_PREFIX = '/mdvault/asset';
		const SHEET_PREFIX = '/mdvault/sheet';

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

		const CSS = [
			'.mdv-root{display:flex;flex-direction:column;min-height:0;color:inherit}',
			'.mdv-toolbar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid rgba(127,127,127,.25);flex:0 0 auto;min-height:38px}',
			'.mdv-title{font-weight:700;font-size:13px;letter-spacing:.02em}',
			'.mdv-sub{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.55;font-size:12px}',
			'.mdv-btn{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px;line-height:1.4}',
			'.mdv-btn:hover{background:rgba(127,127,127,.15)}',
			'.mdv-btn.primary{border-color:rgba(82,155,255,.6);color:#529bff}',
			'.mdv-body{display:flex;min-height:0}',
			'.mdv-side{width:260px;flex:0 0 260px;border-right:1px solid rgba(127,127,127,.22);overflow:auto;padding:8px 6px;box-sizing:border-box;height:calc(100vh - 150px);position:sticky;top:0}',
			'.mdv-main{flex:1;min-width:0;overflow:visible;padding:18px 30px 60px;line-height:1.75;box-sizing:border-box}',
			'.mdv-row{display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap;user-select:none}',
			'.mdv-row:hover{background:rgba(127,127,127,.14)}',
			'.mdv-filerow.active{background:rgba(88,140,255,.22)}',
			'.mdv-dirname{overflow:hidden;text-overflow:ellipsis}',
			'.mdv-caret{width:13px;flex:0 0 13px;opacity:.65;font-size:11px}',
			'.mdv-empty{opacity:.6;padding:26px 14px;font-size:13px;text-align:center;line-height:1.6}',
			'.mdv-docbar{display:flex;align-items:center;gap:10px;margin-bottom:12px}',
			'.mdv-docpath{font-family:ui-monospace,Consolas,monospace;font-size:12px;opacity:.5;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.mdv-saveerr{color:#ff6b6b;font-size:12px;white-space:nowrap}',
			'.mdv-editor{width:100%;box-sizing:border-box;min-height:calc(100vh - 320px);font-family:ui-monospace,Consolas,monospace;font-size:13px;line-height:1.65;padding:14px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.07);color:inherit;resize:vertical}',
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
			'.mdv-assetwrap{display:flex;flex-direction:column;height:calc(100vh - 170px);min-height:460px;border:1px solid rgba(127,127,127,.22);border-radius:8px;overflow:hidden}',
			'.mdv-assettbar{display:flex;align-items:center;gap:10px;padding:6px 14px;border-bottom:1px solid rgba(127,127,127,.22);flex:0 0 auto;background:rgba(127,127,127,.06)}',
			'.mdv-assettname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}',
			'.mdv-frame{flex:1;width:100%;border:none;background:#fff}',
			'.mdv-notice{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;opacity:.85;font-size:14px;text-align:center;padding:20px}',
			'.mdv-dl{color:#529bff;text-decoration:none;border:1px solid rgba(82,155,255,.5);border-radius:6px;padding:5px 16px;font-size:13px}',
			'.mdv-dl:hover{background:rgba(82,155,255,.12)}',
			'.mdv-sbdoc{height:100%;overflow:auto;padding:14px 18px 48px}',
		].join('\n');

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
						key: k,
						className: 'mdv-wiki',
						title: target,
						onClick: function (e) { e.preventDefault(); nav.openFile(target); },
					}, label || target));
				} else if (m[8] !== undefined) {
					const alt = m[8];
					const srcAttr = (m[9] || '').trim();
					const resolved = nav.assetUrl(srcAttr);
					if (resolved) {
						out.push(React.createElement('img', { key: k, className: 'mdv-img', src: resolved, alt: alt }));
					} else if (/^https?:\/\//i.test(srcAttr)) {
						out.push(React.createElement('img', { key: k, className: 'mdv-img', src: srcAttr, alt: alt }));
					} else {
						out.push(React.createElement('span', { key: k, className: 'mdv-img-missing', title: srcAttr }, '\uD83D\uDDBC ' + (alt || srcAttr)));
					}
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
					const renderItem = function (it) {
						const kids = [];
						if (it.task !== null) kids.push(React.createElement('span', { key: 'tk', className: 'mdv-task' }, it.task ? '\u2611' : '\u2610'));
						kids.push.apply(kids, inlineNodes(it.text, nav, 0));
						const liKids = [React.createElement('span', { key: 'c' }, kids)];
						if (it.children.length) liKids.push(renderList(it.children));
						return React.createElement('li', { key: 'li' + (uid++) }, liKids);
					};
					const renderList = function (arr) {
						return React.createElement(arr[0].ordered ? 'ol' : 'ul', { key: 'ls' + (uid++), className: arr[0].task !== null ? 'mdv-tasklist' : '' }, arr.map(renderItem));
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
				const nav = {
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
							if (/\.pdf$/i.test(t)) {
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
						if (!/\.(png|jpe?g|gif|svg|webp)$/i.test(clean)) return '';
						if (!sid) return '';
						const abs = sbResolveAbs(clean, basePath, rootDir);
						if (!abs) return '';
						return sbMediaUrl(sid, abs, '');
					},
				};
				return React.createElement('div', { className: 'mdv-main mdv-sbdoc' }, blockNodes(content, nav));
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
			const tickState = React.useState(0);
			const tick = tickState[0];
			const setTick = tickState[1];
			const selState = React.useState('');
			const selected = selState[0];
			const setSelected = selState[1];
			const docState = React.useState(null);
			const doc = docState[0];
			const setDoc = docState[1];
			const docErrState = React.useState('');
			const docErr = docErrState[0];
			const setDocErr = docErrState[1];
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

			React.useEffect(function () {
				let alive = true;
				setListErr('');
				api('list', { sessionId: sessionId }).then(function (res) {
					if (!alive) return;
					if (res && res.ok) {
						const list = Array.isArray(res.files) ? res.files : [];
						setFiles(list);
						setRootPath(typeof res.root === 'string' ? res.root : '');
						if (list.length) {
							let pick = null;
							for (const f of list) { if (/\.(md|markdown)$/i.test(f.name) && /^readme\.md$/i.test(f.name)) { pick = f; break; } }
							if (!pick) { for (const f of list) { if (/\.(md|markdown)$/i.test(f.name)) { pick = f; break; } } }
							if (pick) setSelected(function (prev) { return prev || pick.path; });
						}
					} else {
						setListErr((res && res.error) || '加载文件列表失败');
					}
				});
				return function () { alive = false; };
			}, [sessionId, tick]);

			React.useEffect(function () {
				if (!selected) { setDoc(null); setDocErr(''); return; }
				let alive = true;
				setDoc(null);
				setDocErr('');
				setEditing(false);
				api('read', { sessionId: sessionId, path: selected }).then(function (res) {
					if (!alive) return;
					if (res && res.ok) setDoc({ path: selected, text: typeof res.text === 'string' ? res.text : '' });
					else setDocErr((res && res.error) || '读取失败');
				});
				return function () { alive = false; };
			}, [selected, sessionId, tick]);

			const fileList = files || [];

			function leaveEdit() { setEditing(false); setSaveErr(''); }

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

			function existsInList(rel) {
				const pl = String(rel || '').toLowerCase();
				if (!pl) return false;
				for (const f of fileList) { if (f.path.toLowerCase() === pl) return true; }
				return false;
			}

			function toRel(t) {
				let r = String(t || '').replace(/\\/g, '/').replace(/^\.\//, '');
				if (r.charAt(0) === '/') r = r.slice(1);
				if (!r) return null;
				const segs = r.split('/');
				for (const s of segs) { if (s === '..' || (s.charAt(0) === '.' && s !== '.')) return null; }
				if (segs.length === 1 && selected) {
					const dir = selected.split('/').slice(0, -1).join('/');
					const cand = dir ? dir + '/' + r : r;
					if (existsInList(cand)) return cand;
					return r;
				}
				return r;
			}

			function buildAssetUrl(rel, frag) {
				return ASSET_PREFIX + '/' + encodeURIComponent(sessionId) + '/' + encodeURIComponent(rel) + (frag ? '#' + frag : '');
			}

			function buildSheetUrl(rel) {
				return SHEET_PREFIX + '?sessionId=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(rel);
			}

			const EMBED_RE = /\.(pdf|png|jpe?g|gif|svg|webp|txt|log)$/i;
			const SHEET_RE = /\.(xlsx|xlsm|xls|csv)$/i;
			const MD_RE = /\.(md|markdown)$/i;

			function findByPath(p) {
				const pl = p.toLowerCase();
				for (const f of fileList) { if (f.path.toLowerCase() === pl) return f; }
				for (const f of fileList) { if (f.path.toLowerCase() === pl + '.md' || f.path.toLowerCase() === pl + '.markdown') return f; }
				return null;
			}

			function openFileImpl(rawTarget) {
				let t = String(rawTarget || '').trim().replace(/\\/g, '/');
				if (!t) return false;
				let frag = '';
				const hi = t.indexOf('#');
				if (hi >= 0) { frag = t.slice(hi + 1); t = t.slice(0, hi); }
				if (!t) return false;
				const lower = t.toLowerCase();
				if (/\.(md|markdown)$/.test(lower)) {
					let hit = findByPath(t);
					if (!hit && t.indexOf('/') < 0 && selected) {
						const dir = selected.split('/').slice(0, -1).join('/');
						hit = findByPath(dir ? dir + '/' + t : t);
					}
					if (!hit) {
						const base = t.split('/').pop().toLowerCase().replace(/\.(md|markdown)$/i, '');
						for (const f of fileList) {
							const nb = f.name.toLowerCase().replace(/\.(md|markdown)$/i, '');
							if (nb === base) { hit = f; break; }
						}
					}
					if (hit) { setAsset(null); setEditing(false); setSelected(hit.path); return true; }
					return false;
				}
				const rel = toRel(t);
				if (!rel) return false;
				const name = rel.split('/').pop();
				if (SHEET_RE.test(name)) {
					setAsset({ name: name, url: buildSheetUrl(rel), embed: true });
					return true;
				}
				if (EMBED_RE.test(name)) {
					setAsset({ name: name, url: buildAssetUrl(rel, frag), embed: true });
				} else {
					setAsset({ name: name, url: buildAssetUrl(rel, ''), embed: false });
				}
				return true;
			}

			function openFromTree(f) {
				if (!f) return;
				if (MD_RE.test(f.name)) { setAsset(null); setEditing(false); setSelected(f.path); return; }
				openFileImpl(f.path);
			}

			function assetUrlImpl(href) {
				const h = String(href || '').trim();
				if (!h || /^https?:\/\//i.test(h) || h.charAt(0) === '#') return '';
				const clean = h.split('#')[0];
				if (!/\.(png|jpe?g|gif|svg|webp)$/i.test(clean)) return '';
				const rel = toRel(clean);
				if (!rel) return '';
				return buildAssetUrl(rel, '');
			}

			const nav = { openFile: openFileImpl, assetUrl: assetUrlImpl };

			function iconOf(name) {
				if (/\.(md|markdown)$/i.test(name)) return '\uD83D\uDCDD';
				if (/\.pdf$/i.test(name)) return '\uD83D\uDCD5';
				if (/\.(xlsx|xlsm|xls|csv)$/i.test(name)) return '\uD83D\uDCD7';
				if (/\.(png|jpe?g|gif|svg|webp)$/i.test(name)) return '\uD83D\uDDBC';
				return '\uD83D\uDCC4';
			}

			function buildTree() {
				const rootNode = { dirs: new Map(), files: [] };
				for (const f of fileList) {
					const segs = f.path.split('/');
					let node = rootNode;
					for (let d = 0; d < segs.length - 1; d++) {
						const s = segs[d];
						if (!node.dirs.has(s)) node.dirs.set(s, { name: s, path: segs.slice(0, d + 1).join('/'), dirs: new Map(), files: [] });
						node = node.dirs.get(s);
					}
					node.files.push(f);
				}
				return rootNode;
			}

			function renderDir(node, depth) {
				const rows = [];
				const dirNames = Array.from(node.dirs.keys()).sort();
				for (const dn of dirNames) {
					const child = node.dirs.get(dn);
					const isOpen = !collapsed[child.path];
					rows.push(React.createElement('div', {
						key: 'd' + child.path,
						className: 'mdv-row',
						style: { paddingLeft: 8 + depth * 14 },
						onClick: function () {
							setCollapsed(function (prev) {
								const next = Object.assign({}, prev);
								next[child.path] = !!isOpen;
								return next;
							});
						},
					},
						React.createElement('span', { className: 'mdv-caret' }, isOpen ? '\u25BE' : '\u25B8'),
						React.createElement('span', { className: 'mdv-dirname' }, '\uD83D\uDCC1 ' + dn),
					));
					if (isOpen) {
						const sub = renderDir(child, depth + 1);
						for (const r of sub) rows.push(r);
					}
				}
				for (const f of node.files) {
					rows.push(React.createElement('div', {
						key: 'f' + f.path,
						className: 'mdv-row mdv-filerow' + (f.path === selected ? ' active' : ''),
						style: { paddingLeft: 24 + depth * 14 },
						title: f.path,
						onClick: function () { openFromTree(f); },
					}, iconOf(f.name) + ' ' + f.name));
				}
				return rows;
			}

			let sideContent;
			if (listErr) sideContent = React.createElement('div', { className: 'mdv-empty' }, '\u26A0\uFE0F ' + listErr);
			else if (files === null) sideContent = React.createElement('div', { className: 'mdv-empty' }, '正在扫描工作区…');
			else if (!fileList.length) sideContent = React.createElement('div', { className: 'mdv-empty' }, '当前工作区里没有找到可预览的文件');
			else sideContent = renderDir(buildTree(), 0);

			let mainContent;
			if (asset) {
				const back = React.createElement('button', { className: 'mdv-btn', onClick: function () { setAsset(null); } }, '\u2190 返回文档');
				if (asset.embed && asset.url) {
					mainContent = React.createElement('div', { className: 'mdv-assetwrap' },
						React.createElement('div', { className: 'mdv-assettbar' }, back,
							React.createElement('span', { className: 'mdv-assettname', title: asset.name }, '\uD83D\uDCC4 ' + asset.name)),
						React.createElement('iframe', { key: asset.url, className: 'mdv-frame', src: asset.url, title: asset.name }),
					);
				} else {
					mainContent = React.createElement('div', { className: 'mdv-assetwrap' },
						React.createElement('div', { className: 'mdv-assettbar' }, back,
							React.createElement('span', { className: 'mdv-assettname', title: asset.name }, '\uD83D\uDCC4 ' + asset.name)),
						React.createElement('div', { className: 'mdv-notice' },
							React.createElement('div', null, asset.url ? '\u26A0\uFE0F 浏览器无法内嵌预览「' + asset.name + '」这个格式' : '\u26A0\uFE0F 预览服务未就绪（刷新后重试）'),
							asset.url ? React.createElement('a', { className: 'mdv-dl', href: asset.url, download: asset.name }, '\u2B07 下载文件') : null,
						),
					);
				}
			} else if (docErr) {
				mainContent = React.createElement('div', { className: 'mdv-empty' }, '\u26A0\uFE0F ' + docErr);
			} else if (!doc) {
				mainContent = React.createElement('div', { className: 'mdv-empty' }, '正在读取 ' + (selected || '') + ' …');
			} else if (editing) {
				mainContent = React.createElement('div', null,
					React.createElement('div', { className: 'mdv-docbar' },
						React.createElement('span', { className: 'mdv-docpath', title: doc.path }, '\u270D 编辑中：' + doc.path),
						saveErr ? React.createElement('span', { className: 'mdv-saveerr' }, '\u26A0 ' + saveErr) : null,
						React.createElement('button', { className: 'mdv-btn primary', disabled: saving, onClick: saveDraft }, saving ? '保存中…' : '\uD83D\uDDBE 保存 (Ctrl+S)'),
						React.createElement('button', { className: 'mdv-btn', onClick: leaveEdit }, '取消'),
					),
					React.createElement('textarea', {
						className: 'mdv-editor',
						value: draft,
						spellCheck: false,
						onChange: function (e) { setDraft(e.target.value); },
						onKeyDown: function (e) {
							if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveDraft(); }
						},
					}),
				);
			} else {
				mainContent = React.createElement('div', null,
					React.createElement('div', { className: 'mdv-docbar' },
						React.createElement('span', { className: 'mdv-docpath', title: doc.path }, doc.path),
						React.createElement('button', { className: 'mdv-btn', onClick: function () { setDraft(doc.text); setSaveErr(''); setEditing(true); } }, '\u270F\uFE0F 编辑'),
					),
					blockNodes(doc.text, nav));
			}

			return React.createElement('div', { className: 'mdv-root' },
				React.createElement('div', { className: 'mdv-toolbar' },
					React.createElement('span', { className: 'mdv-title' }, '\uD83D\uDCC4 文档'),
					React.createElement('span', { className: 'mdv-sub', title: rootPath },
						(fileList.length ? fileList.length + ' 个可预览文件 · ' : '') + rootPath),
					React.createElement('button', { className: 'mdv-btn', onClick: function () { setTick(tick + 1); } }, '\u21BB 刷新'),
				),
				React.createElement('div', { className: 'mdv-body' },
					React.createElement('div', { className: 'mdv-side' }, sideContent),
					React.createElement('div', { className: 'mdv-main' }, mainContent),
				),
			);
		}

		function apply(ctx) {
			insertStyles(CSS);
			mountSidebar(ctx);
			const slots = ctx.get('slots');
			if (slots === undefined) return;
			slots.inject('conversation.view', function () {
				slots.register(
					{ name: 'conversation.view', id: 'mdvault', order: 30, label: '文档' },
					function (props) { return React.createElement(MdVaultView, props); },
				);
			});
		}

		exports.apply = apply;
		return exports;
	},
});
