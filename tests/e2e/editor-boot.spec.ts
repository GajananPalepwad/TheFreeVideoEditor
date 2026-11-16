import { expect, test } from '@playwright/test';

test('editor hydrates, creates and renames a project, and changes theme without browser errors', async ({
	page
}) => {
	const browserProblems: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning') {
			browserProblems.push(`${message.type()}: ${message.text()}`);
		}
	});
	page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`));
	page.on('requestfailed', (request) => {
		browserProblems.push(`requestfailed: ${request.url()} (${request.failure()?.errorText})`);
	});

	await page.addInitScript(() => {
		if (sessionStorage.getItem('tfve:e2e-initialized') === 'true') return;
		localStorage.removeItem('tfve:project-name');
		localStorage.removeItem('tfve:theme');
		sessionStorage.setItem('tfve:e2e-initialized', 'true');
	});
	await page.goto('/editor/');
	await expect(page.getByRole('main', { name: 'Video editing workspace' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Your Projects' })).toBeVisible();
	const managerTitle = page.locator('#project-manager-title');
	await expect(managerTitle).toBeVisible();
	const titleOutline = await managerTitle.evaluate(
		(el) => window.getComputedStyle(el).outlineStyle
	);
	expect(titleOutline).toBe('none');
	await page.getByRole('button', { name: 'New project' }).click();
	await page
		.getByRole('dialog', { name: 'Create a Project' })
		.getByRole('button', {
			name: 'Create project'
		})
		.click();
	await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible();

	const island = page.locator('astro-island');
	await expect(island).toHaveAttribute('client', 'only');
	await expect(island).not.toHaveAttribute('ssr', '');
	await expect(island.locator('.editor-app')).toBeVisible();

	const dimensions = await page.locator('.editor-app').evaluate((root) => ({
		height: root.getBoundingClientRect().height,
		viewportHeight: window.innerHeight,
		timelineHeight: root.querySelector('.timeline-panel')?.getBoundingClientRect().height ?? 0,
		tailwindSpacing: getComputedStyle(document.documentElement).getPropertyValue('--spacing')
	}));
	expect(dimensions.height).toBe(dimensions.viewportHeight);
	expect(dimensions.timelineHeight).toBeGreaterThan(0);
	expect(dimensions.tailwindSpacing.trim()).not.toBe('');

	await page.getByRole('button', { name: 'Switch to light mode' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await page.getByRole('button', { name: 'Rename project: Untitled Project' }).click();
	await page.getByRole('textbox', { name: 'Project name' }).fill('Gate A Project');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Gate A Project' })).toBeVisible();
	await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 10_000 });
	await page.getByRole('button', { name: 'File', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Rename Project' }).click();
	await page.getByRole('textbox', { name: 'Project name' }).fill('File Menu Project');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'File Menu Project' })).toBeVisible();
	await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 10_000 });
	await page.reload();
	await expect(page.getByRole('heading', { name: 'File Menu Project' })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

	expect(browserProblems).toEqual([]);
});

test('top application menus (File, Edit, Help, Guide) close on outside click and close each other when opened', async ({
	page
}) => {
	await page.addInitScript(() => {
		if (sessionStorage.getItem('tfve:e2e-initialized') === 'true') return;
		localStorage.removeItem('tfve:project-name');
		localStorage.removeItem('tfve:theme');
		sessionStorage.setItem('tfve:e2e-initialized', 'true');
	});
	await page.goto('/editor/');
	await page.getByRole('button', { name: 'New project' }).click();
	await page
		.getByRole('dialog', { name: 'Create a Project' })
		.getByRole('button', { name: 'Create project' })
		.click();

	const fileBtn = page.getByRole('button', { name: 'File', exact: true });
	const editBtn = page.getByRole('button', { name: 'Edit', exact: true });
	const helpBtn = page.getByRole('button', { name: 'Help', exact: true });
	const guideBtn = page.getByRole('button', { name: 'Guide', exact: true });

	const fileMenu = page.getByRole('menu', { name: 'File actions' });
	const editMenu = page.getByRole('menu', { name: 'Edit actions' });
	const helpMenu = page.getByRole('menu', { name: 'Help actions' });
	const guideMenu = page.getByRole('menu', { name: 'Guide actions' });

	// Open File menu
	await fileBtn.click();
	await expect(fileMenu).toBeVisible();
	await expect(editMenu).not.toBeVisible();
	await expect(helpMenu).not.toBeVisible();
	await expect(guideMenu).not.toBeVisible();

	// Clicking Edit closes File and opens Edit
	await editBtn.click();
	await expect(fileMenu).not.toBeVisible();
	await expect(editMenu).toBeVisible();
	await expect(helpMenu).not.toBeVisible();
	await expect(guideMenu).not.toBeVisible();

	// Clicking Help closes Edit and opens Help
	await helpBtn.click();
	await expect(fileMenu).not.toBeVisible();
	await expect(editMenu).not.toBeVisible();
	await expect(helpMenu).toBeVisible();
	await expect(guideMenu).not.toBeVisible();

	// Clicking Guide closes Help and opens Guide
	await guideBtn.click();
	await expect(fileMenu).not.toBeVisible();
	await expect(editMenu).not.toBeVisible();
	await expect(helpMenu).not.toBeVisible();
	await expect(guideMenu).toBeVisible();

	// Clicking outside (on the main workspace or viewport) dismisses open menus
	await page.mouse.click(500, 300);
	await expect(fileMenu).not.toBeVisible();
	await expect(editMenu).not.toBeVisible();
	await expect(helpMenu).not.toBeVisible();
	await expect(guideMenu).not.toBeVisible();
});

test('scrollbars are hidden by default and only visible when hovering over a scrollable container', async ({
	page
}) => {
	await page.goto('/editor/');
	const defaultScrollbarColor = await page.evaluate(() => {
		return window.getComputedStyle(document.documentElement).scrollbarColor;
	});
	expect(
		defaultScrollbarColor.includes('transparent') ||
			defaultScrollbarColor.includes('rgba(0, 0, 0, 0)')
	).toBe(true);
});
