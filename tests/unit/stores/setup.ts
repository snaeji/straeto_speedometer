// Provide minimal $state and $derived stubs so that .svelte.ts modules
// can be imported in plain Node without the Svelte compiler.

function makeReactiveState<T>(initial: T): T {
	return initial;
}

// @ts-expect-error — $state is a Svelte 5 rune, not a real function
globalThis.$state = makeReactiveState;
// @ts-expect-error — $derived is a Svelte 5 rune, not a real function
globalThis.$derived = makeReactiveState;
