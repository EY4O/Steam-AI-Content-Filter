/** Everything the plugin draws on store pages. */

export type Mode = 'hide' | 'blur' | 'badge';

const STYLE = `
.aicf-hidden { display: none !important; }
.aicf-rel { position: relative !important; }
.aicf-blur > :not(.aicf-veil) { filter: blur(10px) grayscale(1) !important; opacity: .55; }
.aicf-veil {
	position: absolute; inset: 0; z-index: 20;
	display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 4px;
	cursor: pointer; text-align: center;
	font: 600 12px/1.3 "Motiva Sans", Arial, sans-serif; color: #fff;
	text-shadow: 0 1px 3px #000;
}
.aicf-veil small { font-weight: 400; opacity: .85; }
.aicf-veil:focus-visible { outline: 2px solid #1a9fff; outline-offset: -2px; }
.aicf-pill {
	display: inline-block; padding: 2px 6px; border-radius: 3px;
	background: #c2410c; color: #fff; font: 700 11px/1.2 "Motiva Sans", Arial, sans-serif;
	letter-spacing: .04em; text-shadow: none;
}
.aicf-badge { position: absolute; top: 4px; left: 4px; z-index: 20; pointer-events: none; }
.aicf-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.aicf-gate {
	position: fixed; inset: 0; z-index: 99999;
	display: flex; align-items: center; justify-content: center;
	background: rgba(10, 14, 20, .82); backdrop-filter: blur(18px);
}
.aicf-gate-card {
	max-width: 560px; margin: 16px; padding: 28px 32px; border-radius: 6px;
	background: #1b2838; color: #c7d5e0; box-shadow: 0 12px 48px rgba(0,0,0,.6);
	font: 14px/1.5 "Motiva Sans", Arial, sans-serif;
}
.aicf-gate-title { margin: 10px 0 8px; color: #fff; font-size: 22px; font-weight: 600; line-height: 1.3; }
.aicf-gate-card blockquote {
	margin: 14px 0 20px; padding: 10px 14px; border-left: 3px solid #c2410c;
	background: rgba(0,0,0,.25); font-style: italic; max-height: 180px; overflow: auto;
}
.aicf-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.aicf-hint { margin-top: 14px; font-size: 12px; color: #8f98a0; }
.aicf-btn {
	padding: 8px 14px; border: 0; border-radius: 3px; cursor: pointer;
	background: #3d4450; color: #fff; font: 14px "Motiva Sans", Arial, sans-serif;
}
.aicf-btn:hover { background: #4f5866; }
.aicf-btn:focus-visible { outline: 2px solid #1a9fff; outline-offset: 2px; }
.aicf-btn.primary { background: linear-gradient(90deg, #06bfff, #2d73ff); }
.aicf-btn.primary:hover { filter: brightness(1.1); }

.aicf-banner {
	display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
	margin: 0 0 12px; padding: 10px 14px; border-radius: 3px;
	background: rgba(194, 65, 12, .18); border: 1px solid rgba(194, 65, 12, .55);
	color: #e6d3c7; font: 13px/1.4 "Motiva Sans", Arial, sans-serif;
}
.aicf-banner.muted { background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.12); color: #8f98a0; }
.aicf-banner span.grow { flex: 1; min-width: 200px; }
.aicf-banner .aicf-btn { padding: 4px 10px; font-size: 12px; }

.aicf-chip {
	position: fixed; right: 16px; bottom: 16px; z-index: 9999;
	display: flex; align-items: center; gap: 10px;
	padding: 8px 10px 8px 12px; border-radius: 4px;
	background: #1b2838; border: 1px solid rgba(194, 65, 12, .6); box-shadow: 0 6px 24px rgba(0,0,0,.5);
	color: #c7d5e0; font: 13px/1.3 "Motiva Sans", Arial, sans-serif;
}
.aicf-chip[hidden] { display: none; }
.aicf-chip .aicf-btn { padding: 4px 10px; font-size: 12px; }
`;

export function injectStyles() {
	if (document.getElementById('aicf-style')) return;
	const style = document.createElement('style');
	style.id = 'aicf-style';
	style.textContent = STYLE;
	(document.head ?? document.documentElement).appendChild(style);
}

function ensurePositioned(el: HTMLElement) {
	if (getComputedStyle(el).position === 'static') el.classList.add('aicf-rel');
}

const pill = () => '<span class="aicf-pill" aria-hidden="true">AI</span>';

/** Mark a list entry (capsule, search row, wishlist row…) as an AI game. */
export function markEntry(container: HTMLElement, mode: Mode) {
	if (container.dataset.aicf) return;
	container.dataset.aicf = mode;

	if (mode === 'hide') {
		container.classList.add('aicf-hidden');
		return;
	}

	ensurePositioned(container);
	if (mode === 'badge') {
		const badge = document.createElement('span');
		badge.className = 'aicf-badge';
		badge.innerHTML = `${pill()}<span class="aicf-sr">Has AI-generated content.</span>`;
		badge.title = 'This game has an AI Generated Content Disclosure';
		container.appendChild(badge);
		return;
	}

	container.classList.add('aicf-blur');
	const veil = document.createElement('div');
	veil.className = 'aicf-veil';
	veil.tabIndex = 0;
	veil.setAttribute('role', 'button');
	veil.setAttribute('aria-label', 'Hidden: this game has AI-generated content. Activate to show it.');
	veil.innerHTML = `${pill()}<small aria-hidden="true">AI-generated content · click to show</small>`;
	const reveal = (e: Event) => {
		e.preventDefault();
		e.stopPropagation();
		container.classList.remove('aicf-blur');
		veil.remove();
	};
	veil.addEventListener('click', reveal, { capture: true });
	veil.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') reveal(e);
	});
	container.appendChild(veil);
}

/** Undo markEntry: the element got recycled for another app, or the settings changed. */
export function unmarkEntry(container: HTMLElement) {
	delete container.dataset.aicf;
	container.classList.remove('aicf-hidden', 'aicf-blur', 'aicf-rel');
	container.querySelectorAll(':scope > .aicf-veil, :scope > .aicf-badge').forEach((n) => n.remove());
}

export function escapeHtml(text: string) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

interface GateActions {
	onShowOnce: () => void;
	onAllow: () => Promise<void>;
}

/** Full-screen block for an AI game's own store page. Returns a function that removes it. */
export function showGate(disclosure: string, { onShowOnce, onAllow }: GateActions): () => void {
	const gate = document.createElement('div');
	gate.className = 'aicf-gate';
	gate.innerHTML = `
		<div class="aicf-gate-card" role="alertdialog" aria-modal="true" aria-labelledby="aicf-gate-title" aria-describedby="aicf-gate-desc">
			${pill()}
			<div id="aicf-gate-title" class="aicf-gate-title" role="heading" aria-level="2">This game uses AI-generated content</div>
			<div id="aicf-gate-desc">
				<div>The developers disclosed AI generated content for this game:</div>
				<blockquote>${disclosure ? escapeHtml(disclosure) : 'No description given.'}</blockquote>
			</div>
			<div class="aicf-actions">
				<button class="aicf-btn primary" data-act="back">Go back</button>
				<button class="aicf-btn" data-act="once">Show page this time</button>
				<button class="aicf-btn" data-act="allow">Always allow this game</button>
			</div>
			<div class="aicf-hint">Esc goes back.</div>
		</div>`;

	const prevOverflow = document.documentElement.style.overflow;
	const prevFocus = document.activeElement as HTMLElement | null;
	document.documentElement.style.overflow = 'hidden';

	const close = () => {
		gate.remove();
		document.removeEventListener('keydown', onKey, true);
		document.documentElement.style.overflow = prevOverflow;
		prevFocus?.focus?.();
	};

	const goBack = () => {
		if (history.length > 1) history.back();
		else location.href = '/';
	};

	const buttons = () => [...gate.querySelectorAll<HTMLButtonElement>('button')];

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			goBack();
		} else if (e.key === 'Tab') {
			// keep focus inside the dialog
			const list = buttons();
			const i = list.indexOf(document.activeElement as HTMLButtonElement);
			const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
			e.preventDefault();
			list[next].focus();
		}
	}

	gate.addEventListener('click', async (e) => {
		const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
		if (act === 'back') {
			goBack();
		} else if (act === 'once') {
			onShowOnce();
			close();
		} else if (act === 'allow') {
			await onAllow();
			close();
		}
	});

	document.addEventListener('keydown', onKey, true);
	document.body.appendChild(gate);
	buttons()[0]?.focus();
	return close;
}

/** Inline banner at the top of a store page (badge mode, or an allowlisted AI game). */
export function showBanner(html: string, buttonLabel: string, onClick: () => Promise<void>, muted = false): () => void {
	const banner = document.createElement('div');
	banner.className = `aicf-banner${muted ? ' muted' : ''}`;
	banner.setAttribute('role', 'note');
	banner.innerHTML = `${pill()}<span class="grow">${html}</span><button class="aicf-btn">${escapeHtml(buttonLabel)}</button>`;
	banner.querySelector('button')!.addEventListener('click', async () => {
		await onClick();
		banner.remove();
	});

	// Inside the centered title column, not after it: .page_title_area's parent spans the full window.
	const anchor = document.querySelector('.page_title_area') ?? document.querySelector('.page_content_ctn');
	if (anchor) anchor.appendChild(banner);
	else document.body.prepend(banner);
	return () => banner.remove();
}

/** Floating "N AI games hidden" chip for list pages, with a show/hide toggle for this page. */
export function createChip(onToggle: (revealed: boolean) => void) {
	const chip = document.createElement('div');
	chip.className = 'aicf-chip';
	chip.hidden = true;
	chip.setAttribute('role', 'status');
	chip.innerHTML = `${pill()}<span class="aicf-chip-text"></span><button class="aicf-btn"></button>`;
	const text = chip.querySelector<HTMLElement>('.aicf-chip-text')!;
	const button = chip.querySelector('button')!;

	let revealed = false;
	let count = 0;
	let verb = 'hidden';

	const render = () => {
		chip.hidden = count === 0;
		text.textContent = revealed
			? `Showing ${count} AI game${count === 1 ? '' : 's'}`
			: `${count} AI game${count === 1 ? '' : 's'} ${verb}`;
		button.textContent = revealed ? 'Filter again' : 'Show';
	};

	button.addEventListener('click', () => {
		revealed = !revealed;
		render();
		onToggle(revealed);
	});

	document.body.appendChild(chip);
	return {
		update(nextCount: number, mode: Mode) {
			count = mode === 'badge' ? 0 : nextCount;
			verb = mode === 'blur' ? 'blurred' : 'hidden';
			if (count === 0) revealed = false;
			render();
		},
		get revealed() {
			return revealed;
		},
	};
}
