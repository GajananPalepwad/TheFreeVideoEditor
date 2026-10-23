// Lint and format ratchet for CI: a pull request may not leave a file in worse shape than it found it.
//
// `main` still has lint errors and unformatted files, so checking the whole repo would fail every PR.
// This checks only the changed files and fails when a file has more problems than the same file had
// at the base commit. New files must be clean. Existing debt is tolerated, new debt is not.
//
// Usage: node scripts/ci/ratchet.mjs --tool eslint|prettier --base <sha> --files <nul-separated list>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = ['eslint', 'prettier'];

/** True when `head` has more problems than `base`. A file with no base (`null`) starts from zero. */
export function regressed(head, base) {
	return head > (base ?? 0);
}

/** Splits the NUL-separated file list written by the changed-files action. */
export function splitNul(text) {
	return text.split('\0').filter(Boolean);
}

/** Escapes a value for a GitHub workflow command so a file name cannot start another command. */
export function escapeProperty(value) {
	return String(value)
		.replace(/%/g, '%25')
		.replace(/\r/g, '%0D')
		.replace(/\n/g, '%0A')
		.replace(/:/g, '%3A')
		.replace(/,/g, '%2C');
}

/** Reads and validates the command line. Throws on anything unexpected. */
export function parseArgs(argv) {
	const values = {};
	for (let index = 0; index < argv.length; index += 2) {
		values[argv[index]?.replace(/^--/, '')] = argv[index + 1];
	}
	if (!TOOLS.includes(values.tool)) throw new Error(`--tool must be one of: ${TOOLS.join(', ')}`);
	if (!/^[0-9a-f]{40}$/.test(values.base ?? ''))
		throw new Error('--base must be a full commit sha');
	if (!values.files) throw new Error('--files must point at the changed-files list');
	return { tool: values.tool, base: values.base, files: values.files };
}

/** The file's content at the base commit, or null when the file did not exist there. */
function baseContent(base, file) {
	try {
		return execFileSync('git', ['show', `${base}:${file}`], {
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'ignore']
		});
	} catch {
		return null;
	}
}

/** Builds the per-tool counter. It returns the number of problems in a source text, or null to skip. */
async function createCounter(tool) {
	if (tool === 'eslint') {
		const { ESLint } = await import('eslint');
		const eslint = new ESLint();
		return async (file, text) => {
			if (await eslint.isPathIgnored(file)) return null;
			const [result] = await eslint.lintText(text, { filePath: path.resolve(file) });
			return result.errorCount;
		};
	}
	const prettier = await import('prettier');
	return async (file, text) => {
		const info = await prettier.getFileInfo(file, { ignorePath: '.prettierignore' });
		if (info.ignored || !info.inferredParser) return null;
		const config = (await prettier.resolveConfig(file)) ?? {};
		return (await prettier.check(text, { ...config, filepath: file })) ? 0 : 1;
	};
}

async function main() {
	const { tool, base, files } = parseArgs(process.argv.slice(2));
	const count = await createCounter(tool);
	const unit = tool === 'eslint' ? 'lint errors' : 'unformatted';
	let checked = 0;
	let failed = 0;

	for (const file of splitNul(readFileSync(files, 'utf8'))) {
		const head = await count(file, readFileSync(file, 'utf8'));
		if (head === null) continue;
		checked += 1;
		const before = baseContent(base, file);
		const baseCount = before === null ? null : await count(file, before);
		if (!regressed(head, baseCount)) continue;
		failed += 1;
		const detail =
			tool === 'eslint'
				? `${head} lint errors (was ${baseCount ?? 0} on the base branch). Run: npx eslint ${file}`
				: `not formatted${baseCount === null ? '' : ' (it was formatted on the base branch)'}. Run: npx prettier --write ${file}`;
		console.log(`::error file=${escapeProperty(file)}::${escapeProperty(detail)}`);
		console.log(`FAIL ${file}: ${detail}`);
	}

	console.log(`${tool}: checked ${checked} changed file(s), ${failed} got worse (${unit}).`);
	process.exitCode = failed > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 2;
	});
}
