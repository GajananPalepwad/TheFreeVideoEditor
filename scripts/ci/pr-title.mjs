// Pull request title rules for CI. Titles follow Conventional Commits: `type(scope)!: subject`.
// The pr-title workflow runs this file from the base branch, so it never runs code from a PR.
//
// Usage (CI): PR_TITLE, PR_NUMBER, REPO and GH_TOKEN in the environment, then `node scripts/ci/pr-title.mjs`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TYPES = ['feat', 'fix', 'perf', 'docs', 'style', 'refactor', 'test', 'chore', 'ci'];

const TITLE = new RegExp(`^(${TYPES.join('|')})(?:\\(([^()\\s]+)\\))?(!)?: (\\S.*)$`);

/** Splits a title into its parts, or returns null when it is not a conventional title. */
export function parseTitle(title) {
	const match = TITLE.exec(title.trim());
	if (!match) return null;
	return { type: match[1], scope: match[2] ?? null, breaking: match[3] === '!', subject: match[4] };
}

/** The existing repository labels for a title type. Never names a label that does not exist yet. */
export function labelsFor(type) {
	if (type === 'fix') return ['bug'];
	if (type === 'docs') return ['documentation'];
	return ['enhancement'];
}

function gh(args) {
	return execFileSync('gh', args, { encoding: 'utf8' });
}

function lines(text) {
	return text.split('\n').filter(Boolean);
}

function main() {
	const { PR_TITLE = '', PR_NUMBER = '', REPO = '' } = process.env;
	if (!/^\d+$/.test(PR_NUMBER) || !/^[\w.-]+\/[\w.-]+$/.test(REPO)) {
		throw new Error('PR_NUMBER and REPO must be set to a number and owner/name.');
	}

	const parsed = parseTitle(PR_TITLE);
	if (!parsed) {
		console.log(
			`::error title=Invalid pull request title::Use "type(scope): subject" with type one of ${TYPES.join(', ')}. Example: fix(timeline): stop clips overlapping`
		);
		process.exitCode = 1;
		return;
	}

	// Add only labels the repository already has, and never remove one a person chose.
	const known = lines(gh(['api', '--paginate', `repos/${REPO}/labels`, '--jq', '.[].name']));
	const current = lines(gh(['api', `repos/${REPO}/issues/${PR_NUMBER}`, '--jq', '.labels[].name']));
	for (const label of labelsFor(parsed.type)) {
		if (!known.includes(label)) {
			console.log(
				`::warning::The label "${label}" does not exist in ${REPO}, so it was not added.`
			);
		} else if (!current.includes(label)) {
			gh([
				'api',
				'-X',
				'POST',
				`repos/${REPO}/issues/${PR_NUMBER}/labels`,
				'-f',
				`labels[]=${label}`
			]);
			console.log(`Added label: ${label}`);
		}
	}
	console.log(`Title OK: type=${parsed.type}${parsed.breaking ? ' (breaking)' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(error);
		process.exitCode = 2;
	}
}
