import { definePlugin, DialogButton, Dropdown, Field, SliderField, usePluginConfig } from 'millennium';
import { useState } from 'react';

const MODES = [
	{ data: 'hide', label: 'Hide' },
	{ data: 'blur', label: 'Blur' },
	{ data: 'badge', label: 'Badge only' },
];

const Icon = () => (
	<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
		<circle cx="12" cy="12" r="9" />
		<path d="M5.6 5.6l12.8 12.8" />
		<text x="12" y="15.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">
			AI
		</text>
	</svg>
);

/** Config arrays/maps can arrive as objects with numeric keys; flatten either shape. */
const toIds = (raw: unknown): number[] =>
	raw && typeof raw === 'object' ? Object.values(raw as Record<string, unknown>).map(Number).filter(Number.isFinite) : [];

const SettingsContent = () => {
	// Read through the reactive config hook; write through the backend, which validates and persists.
	const [mode] = usePluginConfig<string>('mode');
	const [cacheDays] = usePluginConfig<number>('cache_days');
	const [allowlist] = usePluginConfig<unknown>('allowlist');
	const [names] = usePluginConfig<Record<string, string>>('allowlist_names');
	const [cleared, setCleared] = useState(false);

	const ids = toIds(allowlist);

	return (
		<>
			<Field
				label="AI games"
				description="What to do with store games that have an AI Generated Content Disclosure. Open store pages update within a few seconds."
				childrenLayout="below"
				bottomSeparator="standard"
			>
				<Dropdown rgOptions={MODES} selectedOption={mode ?? 'hide'} onChange={(opt) => backend.set_mode(opt.data)} />
			</Field>

			<SliderField
				label="Recheck games after"
				description="How long a game's disclosure check is cached before the store page is fetched again."
				value={cacheDays ?? 7}
				min={1}
				max={30}
				step={1}
				valueSuffix=" days"
				showValue
				onChange={(value) => backend.set_cache_days(value)}
			/>

			<Field
				label="Cached checks"
				description="Forget every cached result so all games are checked again."
				childrenLayout="below"
				bottomSeparator="standard"
			>
				<DialogButton
					onClick={async () => {
						await backend.clear_cache();
						setCleared(true);
					}}
				>
					{cleared ? 'Cleared' : 'Clear cache'}
				</DialogButton>
			</Field>

			<Field
				label={`Allowed games (${ids.length})`}
				description={
					ids.length
						? 'These games are never filtered.'
						: 'Use "Always allow this game" on a blocked store page to add one here.'
				}
				bottomSeparator={ids.length ? 'none' : 'standard'}
			/>
			{ids.map((id) => (
				<Field key={id} label={names?.[String(id)] ?? `App ${id}`} description={`App ID ${id}`} indentLevel={1}>
					<DialogButton onClick={() => backend.disallow_app(id)}>Remove</DialogButton>
				</Field>
			))}
		</>
	);
};

export default definePlugin(() => ({
	title: 'AI Content Filter',
	icon: <Icon />,
	content: <SettingsContent />,
}));
