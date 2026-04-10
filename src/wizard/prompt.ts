import readline from "node:readline";

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

/**
 * Prompt the user for text input.
 */
export function ask(question: string, defaultValue?: string): Promise<string> {
	const suffix = defaultValue ? ` (${defaultValue})` : "";
	return new Promise((resolve) => {
		rl.question(`  ${question}${suffix}: `, (answer) => {
			resolve(answer.trim() || defaultValue || "");
		});
	});
}

/**
 * Prompt the user for a yes/no choice.
 */
export function confirm(question: string, defaultYes = true): Promise<boolean> {
	const hint = defaultYes ? "Y/n" : "y/N";
	return new Promise((resolve) => {
		rl.question(`  ${question} (${hint}): `, (answer) => {
			const a = answer.trim().toLowerCase();
			if (a === "") resolve(defaultYes);
			else resolve(a === "y" || a === "yes");
		});
	});
}

/**
 * Prompt the user to pick from a list of options.
 */
export function choose(question: string, options: string[], defaultIndex = 0): Promise<string> {
	return new Promise((resolve) => {
		console.log(`  ${question}`);
		for (let i = 0; i < options.length; i++) {
			const marker = i === defaultIndex ? ">" : " ";
			console.log(`    ${marker} ${i + 1}. ${options[i]}`);
		}
		rl.question(`  Choice (1-${options.length}, default ${defaultIndex + 1}): `, (answer) => {
			const idx = Number.parseInt(answer.trim(), 10) - 1;
			if (idx >= 0 && idx < options.length) {
				resolve(options[idx] ?? options[0] ?? "");
			} else {
				resolve(options[defaultIndex] ?? options[0] ?? "");
			}
		});
	});
}

/**
 * Close the readline interface. Call when wizard is done.
 */
export function closePrompt(): void {
	rl.close();
}
