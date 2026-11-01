/**
 * Looks up whether an app has an AI disclosure, with a localStorage cache and a
 * small request queue so list pages don't hammer the store.
 */
import { headingsFromHtml, isAgeGate, isAiHeading } from './detect';

export type Verdict = 'ai' | 'clean' | 'unknown';

const CACHE_KEY = 'aicf:verdicts:v1';
const EPOCH_KEY = 'aicf:epoch';
const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_TTL_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 3;
const RATE_LIMIT_PAUSE_MS = 30_000;
// The content descriptors sit just above the system requirements; nothing after them matters.
const END_OF_DESCRIPTORS = /class="game_page_autocollapse sys_req"|id="game_area_sys_req|class="sysreq_contents"/;

type Entry = [verdict: Verdict, checkedAt: number];

let cache: Record<string, Entry> = {};
let ttlMs = 7 * DAY_MS;
let saveTimer: number | undefined;

function isFresh(entry: Entry, now = Date.now()) {
	return now - entry[1] < (entry[0] === 'unknown' ? UNKNOWN_TTL_MS : ttlMs);
}

export function initCache(cacheDays: number, epoch: number) {
	setCacheDays(cacheDays);
	try {
		if (localStorage.getItem(EPOCH_KEY) !== String(epoch)) {
			localStorage.removeItem(CACHE_KEY);
			localStorage.setItem(EPOCH_KEY, String(epoch));
		}
		cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') ?? {};
	} catch {
		cache = {};
	}

	// Drop expired entries so the cache doesn't grow forever.
	const now = Date.now();
	let pruned = false;
	for (const [appid, entry] of Object.entries(cache)) {
		if (!Array.isArray(entry) || !isFresh(entry, now)) {
			delete cache[appid];
			pruned = true;
		}
	}
	if (pruned) persist();
}

export function setCacheDays(cacheDays: number) {
	ttlMs = Math.max(1, Number(cacheDays) || 7) * DAY_MS;
}

function persist() {
	clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => {
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
		} catch {
			// storage full or unavailable: the in-memory cache still works for this page
		}
	}, 500);
}

export function cachedVerdict(appid: number): Verdict | undefined {
	const entry = cache[appid];
	return entry && isFresh(entry) ? entry[0] : undefined;
}

export function rememberVerdict(appid: number, verdict: Verdict) {
	cache[appid] = [verdict, Date.now()];
	persist();
}

/** Millennium's IPC already decodes JSON strings returned from Lua; accept either shape. */
export function fromBackend<T>(raw: unknown): T {
	return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}

function verdictFromHeadings(headings: string[]): Verdict {
	return headings.some(isAiHeading) ? 'ai' : 'clean';
}

/** Read the page only up to the end of the content descriptors, then drop the connection. */
async function readUntilDescriptors(res: Response): Promise<string> {
	if (!res.body) return res.text();
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let html = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		html += decoder.decode(value, { stream: true });
		if (END_OF_DESCRIPTORS.test(html)) {
			reader.cancel().catch(() => {});
			break;
		}
	}
	return html;
}

async function lookup(appid: number): Promise<Verdict> {
	const res = await fetch(`/app/${appid}/`, { credentials: 'include' });
	if (res.status === 429) throw new RateLimited();
	if (!res.ok) return 'unknown';
	const html = await readUntilDescriptors(res);

	if (isAgeGate(res.url, html)) {
		// The user's account hasn't passed this age gate; ask the backend to fetch it instead.
		const headings = fromBackend<string[] | Record<string, string> | null>(await backend.fetch_descriptor_headings(appid));
		return headings ? verdictFromHeadings(Object.values(headings)) : 'unknown';
	}
	// Removed or region-locked apps redirect away from their page.
	if (!new RegExp(`/app/${appid}(/|$|\\?)`).test(res.url)) return 'unknown';

	return verdictFromHeadings(headingsFromHtml(html));
}

class RateLimited extends Error {}

const waiting: number[] = [];
const pending = new Map<number, Array<(v: Verdict) => void>>();
let active = 0;
let pausedUntil = 0;
let resumeTimer: number | undefined;

/** Resolve the verdict for an app, from cache when fresh, otherwise via the queue. */
export function check(appid: number): Promise<Verdict> {
	const cached = cachedVerdict(appid);
	if (cached) return Promise.resolve(cached);

	return new Promise((resolve) => {
		const callbacks = pending.get(appid);
		if (callbacks) {
			callbacks.push(resolve);
			return;
		}
		pending.set(appid, [resolve]);
		waiting.push(appid);
		pump();
	});
}

function pump() {
	const wait = pausedUntil - Date.now();
	if (wait > 0) {
		if (resumeTimer === undefined) {
			resumeTimer = window.setTimeout(() => {
				resumeTimer = undefined;
				pump();
			}, wait);
		}
		return;
	}
	while (active < CONCURRENCY && waiting.length) {
		const appid = waiting.shift()!;
		active++;
		lookup(appid)
			.then((verdict) => {
				rememberVerdict(appid, verdict);
				settle(appid, verdict);
			})
			.catch((err) => {
				if (err instanceof RateLimited) {
					pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
					waiting.unshift(appid);
				} else {
					console.warn('[AI Content Filter] lookup failed for', appid, err);
					settle(appid, 'unknown');
				}
			})
			.finally(() => {
				active--;
				pump();
			});
	}
}

function settle(appid: number, verdict: Verdict) {
	const callbacks = pending.get(appid) ?? [];
	pending.delete(appid);
	callbacks.forEach((cb) => cb(verdict));
}
