/** Format a speed value to 1 decimal place. */
export function formatSpeed(speed: number | undefined): string {
	if (speed == null) return '--';
	return speed.toFixed(1);
}

/** Format a timestamp to HH:mm:ss (UTC / Iceland time). */
export function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toISOString().slice(11, 19);
}

/** Format a timestamp to YYYY-MM-DD. */
export function formatDate(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toISOString().slice(0, 10);
}

/** Format a timestamp to HH:mm:ss YYYY-MM-DD. */
export function formatDateTime(timestamp: number): string {
	return `${formatTime(timestamp)} ${formatDate(timestamp)}`;
}

/** Format bytes to human-readable size. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format elapsed time in seconds to mm:ss or hh:mm:ss. */
export function formatElapsed(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format a distance in km. */
export function formatDistance(km: number): string {
	if (km < 1) return `${Math.round(km * 1000)} m`;
	return `${km.toFixed(1)} km`;
}
