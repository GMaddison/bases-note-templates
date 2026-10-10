import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesNoteTemplatesPlugin, { composeNote, readBaseData } from '../src/main';
import { DEFAULT_SETTINGS, describeBase, effectiveFor, normalizeSettings, renamePath, type Settings } from '../src/config';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => resetPro());

/** A stand-in for the SponsorsManager: only isPro and onChange, which the facade uses. */
function fakeManager(start: boolean) {
	let pro = start;
	const fns = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (fn: () => void) => {
			fns.add(fn);
			return () => fns.delete(fn);
		},
		set(v: boolean) {
			pro = v;
			for (const fn of fns) fn();
		},
	};
}

const setup = (extra: Partial<Settings['bases'][string]> = {}): Settings =>
	normalizeSettings({ bases: { 'Tasks.base': { templates: ['T/a.md', 'T/b.md'], views: { Apollo: 'T/apollo.md' }, folder: 'Tasks', pattern: '{{date}}', ...extra } } });

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new BasesNoteTemplatesPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved data', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ hookNew: 'x', dateFormat: 5, bases: { 'a.md': {}, 'b.base': { templates: ['x.md', 'x.md', 3, ' '], folder: '/F/', onNew: 'no' } } })).toEqual({
			...DEFAULT_SETTINGS,
			bases: { 'b.base': { templates: ['x.md'], folder: 'F', pattern: '', onNew: true, views: {} } },
		});
	});

	it('free uses only the first base template and reports the Pro parts as locked', () => {
		const eff = effectiveFor(setup(), 'Tasks.base', 'Apollo', false);
		expect(eff).toEqual({ templates: ['T/a.md'], folder: 'Tasks', pattern: '{{date}}', onNew: true, locked: ['view template', 'more than one template'] });
	});

	it('Pro puts the view template first, then every base template', () => {
		expect(effectiveFor(setup(), 'Tasks.base', 'Apollo', true)?.templates).toEqual(['T/apollo.md', 'T/a.md', 'T/b.md']);
		expect(effectiveFor(setup(), 'Tasks.base', 'Other', true)?.templates).toEqual(['T/a.md', 'T/b.md']);
	});

	it('has no setup for other bases, and the main switch turns the New button off', () => {
		expect(effectiveFor(setup(), 'Other.base', '', true)).toBeNull();
		expect(effectiveFor({ ...setup(), hookNew: false }, 'Tasks.base', '', true)?.onNew).toBe(false);
	});

	it('follows renames of the base and of templates', () => {
		const s = renamePath(renamePath(setup(), 'Tasks.base', 'Work/Tasks.base'), 'T/apollo.md', 'T/moon.md');
		expect(Object.keys(s.bases)).toEqual(['Work/Tasks.base']);
		expect(s.bases['Work/Tasks.base']?.views).toEqual({ Apollo: 'T/moon.md' });
	});

	it('describes a setup in one line', () => {
		expect(describeBase(setup().bases['Tasks.base']!)).toBe('Template: T/a.md, T/b.md. View templates: Apollo -> T/apollo.md. Folder: Tasks. Name: {{date}}.');
	});
});

describe('base file and note text', () => {
	it('reads filters, view names, view filters and columns', () => {
		const data = readBaseData('filters:\n  and:\n    - status == "todo"\nviews:\n  - type: table\n    name: Open\n    order:\n      - file.name\n      - due\n  - type: cards\n');
		expect(data.filters).toEqual({ and: ['status == "todo"'] });
		expect(data.views).toEqual([
			{ name: 'Open', filters: undefined, order: ['file.name', 'due'] },
			{ name: 'View 2', filters: undefined, order: [] },
		]);
	});

	it('survives broken YAML', () => {
		expect(readBaseData('views: [').views).toEqual([]);
		expect(readBaseData('just text').views).toEqual([]);
	});

	it('writes no frontmatter block when there are no properties', () => {
		expect(composeNote({}, 'Body')).toBe('Body');
		expect(composeNote({ status: 'todo' }, 'Body')).toMatch(/^---\nstatus: todo\n---\nBody$/);
	});
});

describe('pro facade', () => {
	it('is off with no manager', () => {
		expect(isPro()).toBe(false);
	});

	it('follows the GitHub Sponsors manager and tells listeners on each change', () => {
		const m = fakeManager(false);
		bindPro(m as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		m.set(false);
		expect(isPro()).toBe(false);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('uses the shared sponsor values and names every Pro feature', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, scope: 'read:user' });
		for (const w of ['more than one template', 'picker', 'each view', 'Templater', 'Duplicate']) expect(PRO_UI.proSummary).toContain(w);
	});
});
