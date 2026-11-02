/**
 * Runs inside Steam's store browser views. Filters games that carry an
 * "AI Generated Content Disclosure" on their store page.
 */
import { fromBackend, initCache, rememberVerdict, setCacheDays } from './checker';
import { disclosureFromDocument } from './detect';
import { startScanner } from './scanner';
import { escapeHtml, injectStyles, Mode, showBanner, showGate } from './ui';

interface Settings {
	mode: Mode;
	cache_days: number;
	cache_epoch: number;
	allowlist: number[] | Record<string, number>;
	keep_owned: boolean;
	keep_wishlisted: boolean;
	show_counter: boolean;
}

const DEFAULTS: Settings = { mode: 'hide', cache_days: 7, cache_epoch: 0, allowlist: [], keep_owned: true, keep_wishlisted: true, show_counter: true };
// Settings are edited in Steam's Quick Access menu, outside this page; poll while the page is visible.
const SETTINGS_POLL_MS = 3000;

let warnedSettings = false;

async function loadSettings(): Promise<Settings> {
	try {
		return { ...DEFAULTS, ...fromBackend<Partial<Settings>>(await backend.get_settings()) };
	} catch (err) {
		if (!warnedSettings) console.warn('[AI Content Filter] using default settings:', err);
		warnedSettings = true;
		return DEFAULTS;
	}
}

const allowlistOf = (s: Settings) => new Set(Object.values(s.allowlist ?? {}).map(Number));

interface UserData {
	owned: Set<number>;
	wishlisted: Set<number>;
}

/** The signed-in user's owned and wishlisted apps, from the same endpoint the store itself uses. */
async function loadUserData(): Promise<UserData> {
	try {
		const res = await fetch('/dynamicstore/userdata/', { credentials: 'include' });
		const data = res.ok ? await res.json() : {};
		const ids = (list: unknown) => new Set(Array.isArray(list) ? list.map(Number).filter(Number.isFinite) : []);
		return { owned: ids(data.rgOwnedApps), wishlisted: ids(data.rgWishlist) };
	} catch (err) {
		console.warn('[AI Content Filter] could not load owned and wishlisted games:', err);
		return { owned: new Set(), wishlisted: new Set() };
	}
}

function keptOf(s: Settings, user: UserData): Map<number, string> {
	const kept = new Map<number, string>();
	if (s.keep_wishlisted) user.wishlisted.forEach((id) => kept.set(id, 'On your wishlist'));
	if (s.keep_owned) user.owned.forEach((id) => kept.set(id, 'In your library'));
	return kept;
}

function domReady() {
	return document.readyState === 'loading'
		? new Promise<void>((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
		: Promise.resolve();
}

function pageAppId(): number | null {
	const m = location.pathname.match(/^\/app\/(\d+)/);
	return m ? Number(m[1]) : null;
}

/** Block screen or banner on an AI game's own store page; re-run whenever settings change. */
function createAppPage(appid: number) {
	// Only trust the page if it rendered the store content (not an age gate or error page).
	const isStorePage =
		!document.getElementById('app_agegate') && !!document.querySelector('.game_page_background, #game_area_purchase');
	if (!isStorePage) return null;

	const { found, text } = disclosureFromDocument(document);
	rememberVerdict(appid, found ? 'ai' : 'clean', text);
	if (!found) return null;

	const name = document.getElementById('appHubAppName')?.textContent?.trim() || 'this game';
	let removeUi = () => {};
	let shownOnce = false;

	return function render(mode: Mode, allowlist: Set<number>, keptReason?: string) {
		removeUi();
		removeUi = () => {};

		if (allowlist.has(appid)) {
			removeUi = showBanner(
				`You allowed <b>${escapeHtml(name)}</b> even though it has an AI Generated Content Disclosure.`,
				'Remove from allowlist',
				async () => {
					await backend.disallow_app(appid);
					render(mode, new Set([...allowlist].filter((id) => id !== appid)), keptReason);
				},
				true,
			);
			return;
		}

		// Re-render right away instead of waiting for the next settings poll.
		const allow = async () => {
			await backend.allow_app(appid, name);
			render(mode, new Set([...allowlist, appid]), keptReason);
		};

		if (mode === 'badge' || shownOnce || keptReason) {
			const kept = keptReason ? ` <span class="aicf-muted">${escapeHtml(keptReason)}, so it isn’t blocked.</span>` : '';
			removeUi = showBanner(
				`This game has an AI Generated Content Disclosure${text ? `: <i>${escapeHtml(text)}</i>` : '.'}${kept}`,
				'Always allow this game',
				allow,
			);
		} else {
			removeUi = showGate(text, {
				onShowOnce: () => {
					// keep the disclosure visible as a banner once the block screen is dismissed
					shownOnce = true;
					queueMicrotask(() => render(mode, allowlist, keptReason));
				},
				onAllow: allow,
			});
		}
	};
}

export default async function main() {
	if (location.hostname !== 'store.steampowered.com' || window.top !== window) return;

	const [initialSettings, user] = await Promise.all([loadSettings(), loadUserData()]);
	let settings = initialSettings;
	initCache(settings.cache_days, settings.cache_epoch);

	await domReady();
	injectStyles();

	const appid = pageAppId();
	const renderAppPage = appid !== null ? createAppPage(appid) : null;
	let kept = keptOf(settings, user);
	renderAppPage?.(settings.mode, allowlistOf(settings), kept.get(appid!));

	const scanner = startScanner({
		mode: settings.mode,
		allowlist: allowlistOf(settings),
		kept,
		showCounter: settings.show_counter,
		pageAppId: appid,
	});

	let lastJson = JSON.stringify(settings);
	const refresh = async () => {
		if (document.hidden) return;
		const next = await loadSettings();
		const json = JSON.stringify(next);
		if (json === lastJson) return;
		lastJson = json;

		if (next.cache_epoch !== settings.cache_epoch) initCache(next.cache_days, next.cache_epoch);
		else setCacheDays(next.cache_days);

		const appearanceChanged =
			next.mode !== settings.mode ||
			next.keep_owned !== settings.keep_owned ||
			next.keep_wishlisted !== settings.keep_wishlisted ||
			next.show_counter !== settings.show_counter ||
			JSON.stringify(next.allowlist) !== JSON.stringify(settings.allowlist);
		settings = next;
		if (!appearanceChanged) return;

		const allowlist = allowlistOf(next);
		kept = keptOf(next, user);
		renderAppPage?.(next.mode, allowlist, kept.get(appid!));
		scanner.update({ mode: next.mode, allowlist, kept, showCounter: next.show_counter, pageAppId: appid });
	};

	setInterval(refresh, SETTINGS_POLL_MS);
	addEventListener('focus', refresh);
	document.addEventListener('visibilitychange', refresh);
}
