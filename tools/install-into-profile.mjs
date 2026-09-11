/**
 * Wire dsh-mdvault into a dsh profile so it appears in the plugin manager.
 *
 * Two facts drive this script:
 *
 * 1. The plugin manager (@linxin666/dsh-client-ui-plugin-manager) builds its
 *    list with `for (const name of Object.keys(manifest.dependencies).sort())`
 *    — it enumerates exactly the profile's package.json dependencies, then
 *    reads each package's own package.json for the version and its
 *    cordis.patch.yml for the entry ids it claims. A plugin mounted only
 *    through a hand-written cordis.patch.yml insert row is invisible to it.
 *
 * 2. Once the package is a `dsh.profile.bundles` entry, its OWN
 *    cordis.patch.yml is applied as a bundle layer — and that file already
 *    contains the insert row. Leaving the hand-written row in the profile patch
 *    as well would mount the same entry id twice.
 *
 * Idempotent, and it backs up every file it touches before writing.
 *
 * Usage: node tools/install-into-profile.mjs [--profile web] [--mode link|tgz] [--apply]
 *        (without --apply it only prints the planned changes)
 *
 * --mode link (default)
 *     The profile depends on the SOURCE DIRECTORY through `link:`, and
 *     node_modules/<name> becomes a junction to it. Editing the source and
 *     restarting `dsh web` is the whole workflow — no repack step. Use this
 *     while developing.
 *
 * --mode tgz
 *     The profile depends on a packed tarball copied into ~/.agents. Use this
 *     to consume a frozen artifact, or on a machine that should not see your
 *     working tree.
 *
 * IMPORTANT: with `file:`-on-a-tarball, running `pnpm install` (which the DSH
 * startup can do) extracts the tarball over node_modules/<name> and destroys
 * anything not shipped in it — a .git directory, for instance. That is exactly
 * why `link:` is the default here.
 */
import { readFile, writeFile, copyFile, stat, lstat, readlink, symlink, rename, mkdir, rm } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const readFlag = (name, fallback) => {
	const i = argv.indexOf('--' + name)
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const profileName = readFlag('profile', 'web')
const mode = readFlag('mode', 'link')
if (!['link', 'tgz'].includes(mode)) {
	console.error('--mode must be link or tgz')
	process.exit(2)
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const profilePkgPath = join(profileDir, 'package.json')
const profilePatchPath = join(profileDir, 'cordis.patch.yml')
const moduleDir = join(profileDir, 'node_modules')

const manifest = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'))
const name = manifest.name
const version = manifest.version

/** The entry id the packaged cordis.patch.yml claims. */
const patchText = await readFile(join(pkgRoot, 'cordis.patch.yml'), 'utf8')
const idMatch = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patchText)
if (idMatch === null) {
	console.error('could not find an "- id:" row in the packaged cordis.patch.yml')
	process.exit(1)
}
const entryId = idMatch[1]

const tarball = `${name}-${version}.tgz`
const tarballSrc = join(pkgRoot, tarball)
const agentsDir = join(homedir(), '.agents')
const tarballDest = join(agentsDir, tarball)

// Forward slashes: safer inside a JSON spec, and the form the existing
// dsh-cmdgo-provider dependency already uses.
const linkSpec = 'link:' + pkgRoot.replace(/\\/g, '/')
const tgzSpec = 'file:' + tarballDest.replace(/\\/g, '/')
const spec = mode === 'link' ? linkSpec : tgzSpec
const linkTarget = join(moduleDir, name)

console.log('package    : ' + name + ' v' + version)
console.log('entry id   : ' + entryId)
console.log('mode       : ' + mode)
console.log('profile    : ' + profileDir)
console.log('spec       : ' + spec)
if (mode === 'tgz') console.log('tarball    : ' + tarballSrc)
console.log('')

if (mode === 'tgz') {
	await stat(tarballSrc).catch(() => {
		console.error('missing ' + tarballSrc + ' — run `npm pack` first')
		process.exit(1)
	})
}

// ── profile package.json ────────────────────────────────────────────────────

const profilePkg = JSON.parse(await readFile(profilePkgPath, 'utf8'))
profilePkg.dsh ??= {}
profilePkg.dsh.profile ??= {}
const bundles = (profilePkg.dsh.profile.bundles ??= [])
const dependencies = (profilePkg.dependencies ??= {})

const bundleAlready = bundles.includes(name)
const depBefore = dependencies[name]
if (!bundleAlready) bundles.push(name)
dependencies[name] = spec

console.log('profile package.json')
console.log('  dsh.profile.bundles       ' + (bundleAlready ? 'already present' : '+ ' + name))
console.log('  dependencies.' + name + '  ' + (depBefore === undefined ? '+ ' + spec : depBefore === spec ? 'already current' : depBefore + '  ->  ' + spec))

// ── profile cordis.patch.yml ────────────────────────────────────────────────

const profilePatch = await readFile(profilePatchPath, 'utf8')

/**
 * Remove a top-level `- insert:` block whose only row declares our entry id,
 * together with the comment lines directly attached above it.
 *
 * Operates on whole lines so unrelated blocks are untouched; everything else in
 * the file (including unrelated comments) is preserved. Only comments with NO
 * blank line between them and the block are absorbed — the usual YAML
 * attachment convention — so a trailing comment about something else survives.
 */
function removeInsertBlock(text, id) {
	const lines = text.split(/\r?\n/)
	const out = []
	let removed = 0
	let i = 0
	while (i < lines.length) {
		const line = lines[i]
		// A top-level insert block starts at column 0 with "- insert:".
		if (!/^- insert:\s*$/.test(line)) { out.push(line); i += 1; continue }
		// Collect the block: the insert line plus every following line that is
		// blank, a comment, or indented.
		const block = [line]
		let j = i + 1
		while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]))) {
			block.push(lines[j])
			j += 1
		}
		const claimsOurs = new RegExp('^\\s*-\\s*id:\\s*' + id + '\\s*$', 'm').test(block.join('\n'))
		const isOnlyOurs = claimsOurs && (block.join('\n').match(/^\s*-\s*id:\s*/gm) ?? []).length === 1
		if (!isOnlyOurs) {
			out.push(...block)
			i = j
			continue
		}
		// Absorb the block's own header comment: walk back over contiguous
		// comment lines already emitted. Blank lines are left alone — the
		// collapse below turns the resulting gap back into a single separator,
		// so an unrelated comment above keeps its blank line.
		while (out.length > 0 && /^#/.test(out[out.length - 1])) out.pop()
		removed += 1
		i = j
	}
	// Collapse any run of blank lines left by the removal.
	const result = out.join('\n').replace(/\n{3,}/g, '\n\n')
	return { text: result, removed }
}

const pruned = removeInsertBlock(profilePatch, entryId)

console.log('')
console.log('profile cordis.patch.yml')
console.log('  insert row for "' + entryId + '": ' + (pruned.removed > 0 ? 'removed (' + pruned.removed + ' block)' : 'none found'))

// ── node_modules link (link mode) ───────────────────────────────────────────

/** What is currently at node_modules/<name>? */
async function currentState() {
	try {
		const st = await lstat(linkTarget)
		if (st.isSymbolicLink()) {
			const target = await readlink(linkTarget)
			return { kind: 'link', target }
		}
		return { kind: 'dir' }
	} catch {
		return { kind: 'absent' }
	}
}

const state = await currentState()
if (mode === 'link') {
	console.log('')
	console.log('node_modules/' + name)
	if (state.kind === 'link' && resolve(state.target) === pkgRoot) {
		console.log('  already a junction to the source — nothing to do')
	} else if (state.kind === 'link') {
		console.log('  junction -> ' + state.target + '   (will repoint to ' + pkgRoot + ')')
	} else if (state.kind === 'dir') {
		console.log('  a real directory   (will be moved aside, then replaced by a junction)')
	} else {
		console.log('  absent             (will create the junction)')
	}
}

if (!apply) {
	console.log('')
	console.log('dry run — re-run with --apply to write.')
	process.exit(0)
}

// ── apply ───────────────────────────────────────────────────────────────────

// `slice(0, 19)` drops both the milliseconds and the trailing Z, so the stamp
// can never end in a dot (Windows strips trailing dots from filenames, which
// would make the reported backup path a lie).
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
const backup = async (path) => {
	const target = path + '.bak-mdvault-' + stamp
	await copyFile(path, target)
	return target
}

const pkgBackup = await backup(profilePkgPath)
const patchBackup = await backup(profilePatchPath)

// Preserve the file's existing formatting: 2-space indent, trailing newline.
await writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n', 'utf8')
await writeFile(profilePatchPath, pruned.text, 'utf8')

let linkNote = ''
if (mode === 'link') {
	await mkdir(moduleDir, { recursive: true })
	if (state.kind === 'dir') {
		// Move rather than delete: reversible if the junction turns out wrong.
		const aside = linkTarget + '.replaced-' + stamp
		await rename(linkTarget, aside)
		linkNote = '  moved old directory aside -> ' + aside + '\n'
	} else if (state.kind === 'link') {
		await rm(linkTarget, { force: true })
	}
	// 'junction' on Windows needs no elevation and no developer mode.
	await symlink(pkgRoot, linkTarget, process.platform === 'win32' ? 'junction' : 'dir')
	linkNote += '  node_modules/' + name + ' -> ' + pkgRoot + ' (junction)\n'
} else {
	await mkdir(agentsDir, { recursive: true }).catch(() => {})
	await copyFile(tarballSrc, tarballDest)
	linkNote = '  tarball -> ' + tarballDest + '\n'
}

console.log('')
console.log('applied:')
console.log(linkNote.trimEnd())
console.log('  package.json     (backup: ' + pkgBackup + ')')
console.log('  cordis.patch.yml (backup: ' + patchBackup + ')')
console.log('')
if (mode === 'link') {
	console.log('maintain the source at: ' + pkgRoot)
	console.log('workflow: edit -> restart `dsh web`. No repack needed.')
	console.log('(lib/client.js even hot-reloads; only lib/index.js needs the restart.)')
} else {
	console.log('next: pnpm install in ' + profileDir + ', then restart dsh web')
}
