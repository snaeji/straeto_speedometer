<script lang="ts">
	import { collectionStore } from '$lib/stores/collection.svelte';

	const phases = [
		{ icon: '🚏', message: 'Opening the depot gates...' },
		{ icon: '⛽', message: 'Fueling up the bus...' },
		{ icon: '☕', message: 'Driver getting coffee...' },
		{ icon: '🔧', message: 'Warming up the engine...' },
		{ icon: '📋', message: 'Pre-trip inspection...' },
		{ icon: '🪞', message: 'Checking the mirrors...' },
		{ icon: '🧑‍🤝‍🧑', message: 'Picking up passengers...' },
		{ icon: '🗺️', message: 'Planning today\'s route...' },
		{ icon: '🚌', message: 'Pulling out of the depot...' },
	];

	let currentPhase = $derived(
		Math.min(
			phases.length - 1,
			Math.floor(collectionStore.warmupProgress * phases.length),
		)
	);

	let progressPercent = $derived(Math.round(collectionStore.warmupProgress * 100));

	let busCount = $derived(collectionStore.warmupBusCount);
	let readingCount = $derived(collectionStore.warmupReadingCount);
</script>

<div class="loading-screen">
	<div class="loading-content">
		<!-- Phase icon -->
		<div class="phase-icon">
			{phases[currentPhase].icon}
		</div>

		<!-- Phase message -->
		<div class="phase-message">
			{phases[currentPhase].message}
		</div>

		<!-- Progress ring -->
		<div class="progress-ring-container">
			<svg viewBox="0 0 120 120" class="progress-ring">
				<!-- Background track -->
				<circle
					cx="60" cy="60" r="52"
					fill="none"
					stroke="rgba(255,255,255,0.06)"
					stroke-width="4"
				/>
				<!-- Progress arc -->
				<circle
					cx="60" cy="60" r="52"
					fill="none"
					stroke="url(#progressGradient)"
					stroke-width="4"
					stroke-linecap="round"
					stroke-dasharray={2 * Math.PI * 52}
					stroke-dashoffset={2 * Math.PI * 52 * (1 - collectionStore.warmupProgress)}
					transform="rotate(-90 60 60)"
					style="transition: stroke-dashoffset 0.3s ease"
				/>
				<defs>
					<linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
						<stop offset="0%" stop-color="#06b6d4" />
						<stop offset="100%" stop-color="#10b981" />
					</linearGradient>
				</defs>
			</svg>
			<div class="progress-text">{progressPercent}%</div>
		</div>

		<!-- Stats -->
		<div class="warmup-stats">
			<div class="stat">
				<span class="stat-value">{busCount}</span>
				<span class="stat-label">buses found</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat">
				<span class="stat-value">{readingCount.toLocaleString()}</span>
				<span class="stat-label">readings buffered</span>
			</div>
		</div>

		<!-- Phase dots -->
		<div class="phase-dots">
			{#each phases as _, i}
				<div
					class="phase-dot"
					class:active={i <= currentPhase}
					class:current={i === currentPhase}
				></div>
			{/each}
		</div>
	</div>
</div>

<style>
	.loading-screen {
		position: absolute;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		background: radial-gradient(ellipse at center, rgba(3, 7, 18, 0.95) 0%, rgba(3, 7, 18, 0.99) 100%);
		animation: fade-in 0.5s ease;
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.loading-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		max-width: 320px;
		text-align: center;
	}

	.phase-icon {
		font-size: 48px;
		line-height: 1;
		animation: gentle-bounce 2s ease-in-out infinite;
	}

	@keyframes gentle-bounce {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-6px); }
	}

	.phase-message {
		font-size: 16px;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.8);
		letter-spacing: 0.02em;
		min-height: 24px;
		animation: text-fade 0.4s ease;
	}

	@keyframes text-fade {
		from { opacity: 0; transform: translateY(4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.progress-ring-container {
		position: relative;
		width: 120px;
		height: 120px;
	}

	.progress-ring {
		width: 100%;
		height: 100%;
	}

	.progress-text {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 24px;
		font-weight: 600;
		font-family: 'JetBrains Mono', monospace;
		color: rgba(255, 255, 255, 0.9);
	}

	.warmup-stats {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 12px 20px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 12px;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.stat-value {
		font-size: 18px;
		font-weight: 600;
		font-family: 'JetBrains Mono', monospace;
		color: #06b6d4;
	}

	.stat-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgba(255, 255, 255, 0.4);
	}

	.stat-divider {
		width: 1px;
		height: 32px;
		background: rgba(255, 255, 255, 0.08);
	}

	.phase-dots {
		display: flex;
		gap: 6px;
	}

	.phase-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.1);
		transition: all 0.3s ease;
	}

	.phase-dot.active {
		background: rgba(6, 182, 212, 0.4);
	}

	.phase-dot.current {
		background: #06b6d4;
		box-shadow: 0 0 8px rgba(6, 182, 212, 0.5);
	}
</style>
