/**
 * Finds game entries on list-style store pages (search, front page carousels,
 * wishlist, discovery queue, "more like this"…) and filters the AI ones.
 *
 * Most of the store is React with hashed class names, so entries are found by
 * their app links and the hidden container is the largest ancestor that still
 * only points at that one app.
 */
import { cachedNotes, cachedVerdict, check } from './checker';
import { createChip, markEntry, Mode, unmarkEntry } from './ui';

const CANDIDATES = 'a[href*="/app/"], [data-ds-appid]';
const APP_URL = /^https?:\/\/store\.steampowered\.com\/app\/(\d+)/;
const OWN_UI = '.aicf-gate, .aicf-banner, .aicf-veil, .aicf-chip';

// Legacy store markup with a known card element; checked before the generic climb.
const KNOWN_CARDS = [
	'.search_result_row',
	'.tab_item',
	'.store_capsule',
	'.small_cap',
	'.wishlist_row',
	'.recommendation',
	'.similar_grid_item',
	'.home_area_spotlight',
	'.dailydeal_ctn',
	'.spotlight_block',
].join(',');

const MAX_CLIMB = 8;
// A "card" bigger than this share of the viewport is probably a whole section; blur instead of hiding.
const MAX_HIDE_AREA = 0.5;

export interface ScanOptions {
	mode: Mode;
	allowlist: Set<number>;
	/** Owned or wishlisted apps that are badged instead of hidden or blurred, with the reason shown. */
	kept: Map<number, string>;
	/** Whether to show the "N AI games hidden" chip. */
	showCounter: boolean;
	/** The app whose store page we're on; its own links are left alone. */
	pageAppId: number | null;
}

function appidOf(el: Element): number | null {
	const ds = el.getAttribute('data-ds-appid');
	if (ds && /^\d+$/.test(ds)) return Number(ds);
	if (el instanceof HTMLAnchorElement) {
		const m = el.href.match(APP_URL);
		if (m) return Number(m[1]);
	}
	return null;
}

function onlyPointsAt(root: Element, appid: number): boolean {
	for (const el of root.querySelectorAll(CANDIDATES)) {
		const other = appidOf(el);
		if (other !== null && other !== appid) return false;
	}
	return true;
}

function containerFor(el: HTMLElement, appid: number): HTMLElement {
	const known = el.closest<HTMLElement>(KNOWN_CARDS);
	if (known && onlyPointsAt(known, appid)) return known;

	let node = el;
	for (let i = 0; i < MAX_CLIMB; i++) {
		const parent = node.parentElement;
		if (!parent || parent === document.body || parent.matches('main, #global_header, .page_content_ctn')) break;
		if (parent.querySelector('h1, h2') || !onlyPointsAt(parent, appid)) break;
		node = parent;
	}
	return node;
}

function fitsHide(container: HTMLElement): boolean {
	const rect = container.getBoundingClientRect();
	return rect.width * rect.height <= MAX_HIDE_AREA * innerWidth * innerHeight;
}

export function startScanner(initial: ScanOptions) {
	let opts = initial;
	// element -> appid it was last evaluated for (React recycles elements between apps)
	let seen = new WeakMap<Element, number>();
	let marked = new WeakMap<Element, HTMLElement>();

	const chip = createChip(() => reset());
	const shouldMark = (appid: number) => !chip.revealed && !opts.allowlist.has(appid);

	const apply = (el: HTMLElement, appid: number) => {
		if (seen.get(el) !== appid || !el.isConnected || !shouldMark(appid)) return;
		const container = containerFor(el, appid);
		const keptReason = opts.kept.get(appid);
		const mode = keptReason ? 'badge' : opts.mode === 'hide' && !fitsHide(container) ? 'blur' : opts.mode;
		markEntry(container, mode, { notes: cachedNotes(appid), keptReason });
		marked.set(el, container);
	};

	// A game often appears several times (capsule + tab row + hidden tab); mark every copy.
	const applyEverywhere = (appid: number) => {
		for (const el of document.querySelectorAll<HTMLElement>(CANDIDATES)) {
			if (seen.get(el) === appid && !marked.has(el)) {
				visibility.unobserve(el);
				apply(el, appid);
			}
		}
	};

	const visibility = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const el = entry.target as HTMLElement;
				visibility.unobserve(el);
				const appid = seen.get(el);
				if (appid === undefined) continue;
				check(appid).then((verdict) => {
					if (verdict !== 'ai') return;
					applyEverywhere(appid);
					schedule();
				});
			}
		},
		{ rootMargin: '400px 0px' },
	);

	const scan = () => {
		const aiApps = new Set<number>();
		for (const el of document.querySelectorAll<HTMLElement>(CANDIDATES)) {
			if (el.closest(OWN_UI)) continue;
			const appid = appidOf(el);
			if (appid === null || appid === opts.pageAppId || opts.allowlist.has(appid)) continue;

			const cached = cachedVerdict(appid);
			if (cached === 'ai' && !opts.kept.has(appid)) aiApps.add(appid);
			if (seen.get(el) === appid) continue;

			const previous = marked.get(el);
			if (previous) {
				unmarkEntry(previous);
				marked.delete(el);
			}
			seen.set(el, appid);

			if (cached === 'ai') apply(el, appid);
			else if (cached === undefined) visibility.observe(el);
		}
		chip.update(opts.showCounter ? aiApps.size : 0, opts.mode);
	};

	/** Forget every decision and re-run with the current options (settings changed or chip toggled). */
	const reset = () => {
		visibility.disconnect();
		document.querySelectorAll<HTMLElement>('[data-aicf]').forEach(unmarkEntry);
		seen = new WeakMap();
		marked = new WeakMap();
		scan();
	};

	let queued = false;
	function schedule() {
		if (queued) return;
		queued = true;
		setTimeout(() => {
			queued = false;
			scan();
		}, 150);
	}

	new MutationObserver(schedule).observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['href', 'data-ds-appid'],
	});
	scan();

	return {
		update(next: ScanOptions) {
			opts = next;
			reset();
		},
	};
}
