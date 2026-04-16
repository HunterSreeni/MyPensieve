/**
 * Wizard prompt layer - wraps @clack/prompts for the init wizard.
 *
 * Exports the same API as the old readline-based prompt.ts (ask, confirm,
 * choose, closePrompt) plus new prompt types (multiselect, spin).
 * This lets existing steps work unchanged while new steps use richer UI.
 */
import * as clack from "@clack/prompts";

/**
 * Prompt the user for text input.
 */
export async function ask(question: string, defaultValue?: string): Promise<string> {
	const result = await clack.text({
		message: question,
		placeholder: defaultValue ?? "",
		defaultValue: defaultValue ?? "",
	});
	if (clack.isCancel(result)) {
		clack.cancel("Wizard cancelled.");
		process.exit(0);
	}
	return (result as string).trim() || defaultValue || "";
}

/**
 * Prompt the user for a yes/no choice.
 */
export async function confirm(question: string, defaultYes = true): Promise<boolean> {
	const result = await clack.confirm({
		message: question,
		initialValue: defaultYes,
	});
	if (clack.isCancel(result)) {
		clack.cancel("Wizard cancelled.");
		process.exit(0);
	}
	return result as boolean;
}

/**
 * Prompt the user to pick from a list of options (radio/single-select).
 */
export async function choose(
	question: string,
	options: string[],
	defaultIndex = 0,
): Promise<string> {
	const result = await clack.select({
		message: question,
		options: options.map((label, i) => ({
			value: label,
			label,
			hint: i === defaultIndex ? "default" : undefined,
		})),
		initialValue: options[defaultIndex],
	});
	if (clack.isCancel(result)) {
		clack.cancel("Wizard cancelled.");
		process.exit(0);
	}
	return result as string;
}

/**
 * Prompt the user to pick multiple items from a list (checkbox/multi-select).
 * Returns the selected values.
 */
export async function multiselect(
	question: string,
	options: Array<{ value: string; label: string; hint?: string }>,
	required = false,
): Promise<string[]> {
	const result = await clack.multiselect({
		message: question,
		options,
		required,
	});
	if (clack.isCancel(result)) {
		clack.cancel("Wizard cancelled.");
		process.exit(0);
	}
	return result as string[];
}

/**
 * Show a spinner while an async operation runs.
 */
export async function spin<T>(message: string, fn: () => Promise<T>): Promise<T> {
	const s = clack.spinner();
	s.start(message);
	try {
		const result = await fn();
		s.stop(message);
		return result;
	} catch (err) {
		s.stop("Failed");
		throw err;
	}
}

/**
 * Print an intro banner.
 */
export function intro(title: string): void {
	clack.intro(title);
}

/**
 * Print an outro banner.
 */
export function outro(message: string): void {
	clack.outro(message);
}

/**
 * Log a note (boxed message).
 */
export function note(message: string, title?: string): void {
	clack.note(message, title);
}

/**
 * Close the prompt interface. No-op for clack (no readline to close).
 */
export function closePrompt(): void {
	// clack handles cleanup internally - no manual close needed
}
