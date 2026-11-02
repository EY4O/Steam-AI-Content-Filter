/**
 * Looks up whether an app has an AI disclosure, with a localStorage cache. Apps are
 * looked up in batches through Steam's store API; any it can't answer fall back to a
 * small queue that reads the app's store page.
 */
import { disclosureFromDocument, headingsFromHtml, isAgeGate, isAiHeading } from './detect';

export type Verdict = 'ai' | 'clean' | 'unknown';

/** A lookup result; `notes` is the developer's disclosure text, when there is one. */
interface Found {
	verdict: Verdict;
	notes?: string;
}

// v2 entries carry the disclosure text; v1 had verdicts only.
const CACHE_KEY = 'aicf:verdicts:v2';
const OLD_CACHE_KEYS = ['aicf:verdicts:v1'];
const EPOCH_KEY = 'aicf:epoch';
const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_TTL_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 3;
const RATE_LIMIT_PAUSE_MS = 30_000;

const GET_ITEMS = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const BATCH_SIZE = 40;
const BATCH_CONCURRENCY = 2;
// Short wait so apps that scroll into view together share one request.
const BATCH_GATHER_MS = 50;
const API_DOWN_PAUSE_MS = 5 * 60 * 1000;
// Enough for the tooltip; keeps the localStorage cache small.
const NOTES_MAX = 600;
// The content descriptors sit just above the system requirements; nothing after them matters.
const END_OF_DESCRIPTORS = /class="game_page_autocollapse sys_req"|id="game_area_sys_req|class="sysreq_contents"/;

type Entry = [verdict: Verdict, checkedAt: number, notes?: string];

let cache: Record<string, Entry> = {};
let ttlMs = 7 * DAY_MS;
let saveTimer: number | undefined;

function isFresh(entry: Entry, now = Date.now()) {
	return now - entry[1] < (entry[0] === 'unknown' ? UNKNOWN_TTL_MS : ttlMs);
}

export function initCache(cacheDays: number, epoch: number) {
	setCacheDays(cacheDays);
	try {
		OLD_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
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

export function cachedNotes(appid: number): string | undefined {
	return cache[appid]?.[2];
}

export function rememberVerdict(appid: number, verdict: Verdict, notes?: string) {
	const text = verdict === 'ai' ? notes?.replace(/\s+/g, ' ').trim().slice(0, NOTES_MAX) : undefined;
	cache[appid] = text ? [verdict, Date.now(), text] : [verdict, Date.now()];
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

async function lookup(appid: number): Promise<Found> {
	const res = await fetch(`/app/${appid}/`, { credentials: 'include' });
	if (res.status === 429) throw new RateLimited();
	if (!res.ok) return { verdict: 'unknown' };
	const html = await readUntilDescriptors(res);

	if (isAgeGate(res.url, html)) {
		// The user's account hasn't passed this age gate; ask the backend to fetch it instead.
		const headings = fromBackend<string[] | Record<string, string> | null>(await backend.fetch_descriptor_headings(appid));
		return { verdict: headings ? verdictFromHeadings(Object.values(headings)) : 'unknown' };
	}
	// Removed or region-locked apps redirect away from their page.
	if (!new RegExp(`/app/${appid}(/|$|\\?)`).test(res.url)) return { verdict: 'unknown' };

	const verdict = verdictFromHeadings(headingsFromHtml(html));
	if (verdict !== 'ai') return { verdict };
	return { verdict, notes: disclosureFromDocument(new DOMParser().parseFromString(html, 'text/html')).text };
}

class RateLimited extends Error {}

function storeCountry(): string {
	try {
		const config = JSON.parse(document.getElementById('application_config')?.dataset.config ?? '{}');
		if (typeof config.COUNTRY === 'string' && /^[A-Z]{2}$/.test(config.COUNTRY)) return config.COUNTRY;
	} catch {
		// fall through
	}
	return 'US';
}

/**
 * Ask the store API about up to BATCH_SIZE apps at once. Its `content_survey_ai_notes`
 * field holds the developer's AI disclosure and is the same in every language. Apps the
 * API doesn't return (removed, region-locked, not an app) are left out of the result.
 */
async function lookupBatch(appids: number[]): Promise<Map<number, Found>> {
	const input = {
		ids: appids.map((appid) => ({ appid })),
		context: { language: 'english', country_code: storeCountry() },
		data_request: { include_extra_details: true },
	};
	const res = await fetch(`${GET_ITEMS}?input_json=${encodeURIComponent(JSON.stringify(input))}`, { credentials: 'omit' });
	if (!res.ok) throw new Error(`GetItems HTTP ${res.status}`);
	const items: any[] = (await res.json())?.response?.store_items;
	if (!Array.isArray(items)) throw new Error('GetItems: no store_items');

	const results = new Map<number, Found>();
	for (const item of items) {
		if (item?.success !== 1 || item.visible !== true || item.appid !== item.id || !appids.includes(item.appid)) continue;
		const notes = item.extra_details?.content_survey_ai_notes;
		results.set(item.appid, typeof notes === 'string' && notes.trim() ? { verdict: 'ai', notes } : { verdict: 'clean' });
	}
	return results;
}

const pending = new Map<number, Array<(v: Verdict) => void>>();

/** Resolve the verdict for an app, from cache when fresh, otherwise via the queues. */
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
		batchWaiting.push(appid);
		scheduleBatch();
	});
}

// ---- API batches

const batchWaiting: number[] = [];
let batchActive = 0;
let batchTimer: number | undefined;
let apiDownUntil = 0;

function scheduleBatch() {
	if (batchTimer === undefined) batchTimer = window.setTimeout(pumpBatches, BATCH_GATHER_MS);
}

function pumpBatches() {
	batchTimer = undefined;
	if (Date.now() < apiDownUntil) {
		// The API is failing; send everything straight to the page queue.
		waiting.push(...batchWaiting.splice(0));
		pump();
		return;
	}
	while (batchActive < BATCH_CONCURRENCY && batchWaiting.length) {
		const appids = batchWaiting.splice(0, BATCH_SIZE);
		batchActive++;
		lookupBatch(appids)
			.catch((err) => {
				console.warn('[AI Content Filter] store API lookup failed, reading store pages instead:', err);
				apiDownUntil = Date.now() + API_DOWN_PAUSE_MS;
				return new Map<number, Found>();
			})
			.then((results) => {
				for (const appid of appids) {
					const found = results.get(appid);
					if (found) {
						rememberVerdict(appid, found.verdict, found.notes);
						settle(appid, found.verdict);
					} else {
						waiting.push(appid);
					}
				}
				pump();
			})
			.finally(() => {
				batchActive--;
				if (batchWaiting.length) scheduleBatch();
			});
	}
}

// ---- store page fallback

const waiting: number[] = [];
let active = 0;
let pausedUntil = 0;
let resumeTimer: number | undefined;

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
			.then((found) => {
				rememberVerdict(appid, found.verdict, found.notes);
				settle(appid, found.verdict);
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
