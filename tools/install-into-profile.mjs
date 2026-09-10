/**
 * Wire dsh-mdvault into a dsh profile so it appears in the plugin manager.
 *
 * Why this exists as a script: the plugin manager enumerates exactly the
 * profile's `package.json` dependencies, so a plugin mounted only through a
 * hand-written `cordis.patch.yml` insert row is invisible to it. Becoming a
 * dependency + a bundles entry is what `dsh-cmdgo-provider` does.
 *
 * The one non-obvious consequence, handled here: once `dsh-mdvault` is a
 * bundles entry, its own packaged `cordis.patch.yml` is applied as a bundle
 * layer — and that file already contains the insert row. Leaving the
 * hand-written row in the profile patch too would mount the same entry id
 * twice, so this script removes it.
 *
 * Idempotent, and it backs up every file it touches before writing.
 *
 * Usage: node tools/install-into-profile.mjs [--profile web] [--apply]
 *        (without --apply it only prints the planned changes)
 */
import { readFile, writeFile, copyFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const profileIdx = argv.indexOf('--profile')
const profileName = profileIdx >= 0 ? argv[profileIdx + 1] : 'web'
if (!profileName) {
	console.error('usage: node tools/install-into-profile.mjs [--profile <name>] [--apply]')
	process.exit(2)
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const profilePkgPath = join(profileDir, 'package.json')
const profilePatchPath = join(profileDir, 'cordis.patch.yml')

const manifest = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'))
const name = manifest.name
const version = manifest.version
const tarball = `${name}-${version}.tgz`
const tarballSrc = join(pkgRoot, tarball)
const agentsDir = join(homedir(), '.agents')
const tarballDest = join(agentsDir, tarball)
// Forward slashes: a Windows path in a JSON spec is safer this way, and this is
// exactly the form the existing dsh-cmdgo-provider dependency uses.
const fileSpec = 'file:' + tarballDest.replace(/\\/g, '/')

/** The entry id the packaged cordis.patch.yml claims. */
const patchText = await readFile(join(pkgRoot, 'cordis.patch.yml'), 'utf8')
const idMatch = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patchText)
if (idMatch === null) {
	console.error('could not find an "- id:" row in the packaged cordis.patch.yml')
	process.exit(1)
}
const entryId = idMatch[1]

console.log('package   : ' + name + ' v' + version)
console.log('entry id  : ' + entryId)
console.log('profile   : ' + profileDir)
console.log('tarball   : ' + tarballSrc)
console.log('')

await stat(tarballSrc).catch(() => {
	console.error('missing ' + tarballSrc + ' — run `npm pack` first')
	process.exit(1)
})

// ── profile package.json ────────────────────────────────────────────────────

const profilePkgRaw = await readFile(profilePkgPath, 'utf8')
const profilePkg = JSON.parse(profilePkgRaw)

profilePkg.dsh ??= {}
profilePkg.dsh.profile ??= {}
const bundles = (profilePkg.dsh.profile.bundles ??= [])
const dependencies = (profilePkg.dependencies ??= {})

const bundleAlready = bundles.includes(name)
const depAlready = Object.prototype.hasOwnProperty.call(dependencies, name)
const depIsCurrent = dependencies[name] === fileSpec

if (!bundleAlready) bundles.push(name)
dependencies[name] = fileSpec

console.log('profile package.json')
console.log('  dsh.profile.bundles  ' + (bundleAlready ? 'already present' : '+ ' + name))
console.log('  dependencies.' + name + '  ' + (depAlready ? (depIsCurrent ? 'already current' : 'updated -> ' + fileSpec) : '+ ' + fileSpec))

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
	let result = out.join('\n')
	// Collapse any run of blank lines left by the removal.
	result = result.replace(/\n{3,}/g, '\n\n')
	return { text: result, removed }
}

const pruned = removeInsertBlock(profilePatch, entryId)

console.log('')
console.log('profile cordis.patch.yml')
if (bundleAlready) {
	console.log('  (bundle already present; the manual row is still removed if found)')
}
console.log('  insert row for "' + entryId + '": ' + (pruned.removed > 0 ? 'removed (' + pruned.removed + ' block)' : 'none found'))

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

await copyFile(tarballSrc, join(agentsDir, tarball)).catch(async () => {
	// ~/.agents may not exist yet.
	const { mkdir } = await import('node:fs/promises')
	await mkdir(agentsDir, { recursive: true })
	await copyFile(tarballSrc, join(agentsDir, tarball))
})

const pkgBackup = await backup(profilePkgPath)
const patchBackup = await backup(profilePatchPath)

// Preserve the file's existing formatting: 2-space indent, trailing newline.
await writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n', 'utf8')
await writeFile(profilePatchPath, pruned.text, 'utf8')

console.log('')
console.log('applied:')
console.log('  tarball  -> ' + tarballDest)
console.log('  package.json    (backup: ' + pkgBackup + ')')
console.log('  cordis.patch.yml (backup: ' + patchBackup + ')')
console.log('')
console.log('next: pnpm install in ' + profileDir + ', then restart dsh web')
