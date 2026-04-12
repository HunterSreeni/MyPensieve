import fs from "node:fs";
import path from "node:path";
import { INIT_PROGRESS_PATH } from "../config/paths.js";
import { captureError } from "../ops/index.js";

export interface WizardStep {
	name: string;
	description: string;
	run: (state: WizardState) => Promise<void>;
}

export interface WizardState {
	/** Accumulated config being built */
	config: Record<string, unknown>;
	/** Whether the wizard is in interactive mode */
	interactive: boolean;
	/** Completed step indices */
	completedSteps: number[];
}

export interface WizardProgress {
	completedSteps: number[];
	state: Record<string, unknown>;
	lastUpdated: string;
}

/**
 * Read wizard progress for resumability.
 */
export function readProgress(): WizardProgress | null {
	if (!fs.existsSync(INIT_PROGRESS_PATH)) return null;
	try {
		return JSON.parse(fs.readFileSync(INIT_PROGRESS_PATH, "utf-8")) as WizardProgress;
	} catch {
		return null;
	}
}

/**
 * Save wizard progress after each step.
 */
export function saveProgress(progress: WizardProgress): void {
	const dir = path.dirname(INIT_PROGRESS_PATH);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(INIT_PROGRESS_PATH, JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * Clear wizard progress (for restart).
 */
export function clearProgress(): void {
	if (fs.existsSync(INIT_PROGRESS_PATH)) {
		fs.unlinkSync(INIT_PROGRESS_PATH);
	}
}

/**
 * Run the wizard, optionally resuming from a previous attempt.
 */
export async function runWizard(
	steps: WizardStep[],
	opts?: { restart?: boolean },
): Promise<WizardState> {
	const progress = opts?.restart ? null : readProgress();

	const state: WizardState = {
		config: progress?.state ?? {},
		interactive: true,
		completedSteps: progress?.completedSteps ?? [],
	};

	const startFrom = state.completedSteps.length;

	if (startFrom > 0) {
		console.log(`\nResuming wizard from step ${startFrom + 1} of ${steps.length}...`);
	}

	let currentStepName: string | undefined;
	try {
		for (let i = startFrom; i < steps.length; i++) {
			const step = steps[i];
			if (!step) continue;
			currentStepName = step.name;
			console.log(`\n[Step ${i + 1}/${steps.length}] ${step.description}`);

			try {
				await step.run(state);
			} catch (stepErr) {
				const e = stepErr instanceof Error ? stepErr : new Error(String(stepErr));
				captureError({
					severity: "critical",
					errorType: "wizard_step_failed",
					errorSrc: `wizard:step:${step.name}`,
					message: e.message,
					stack: e.stack,
					context: {
						stepIndex: i,
						stepName: step.name,
						stepDescription: step.description,
					},
				});
				throw stepErr;
			}

			state.completedSteps.push(i);
			saveProgress({
				completedSteps: state.completedSteps,
				state: state.config,
				lastUpdated: new Date().toISOString(),
			});
		}

		// Clean up progress file on completion
		clearProgress();
	} catch (err) {
		// Ensure readline is closed on error
		try {
			const { closePrompt } = await import("./prompt.js");
			closePrompt();
		} catch {
			// prompt module may not be loaded
		}
		if (currentStepName === undefined) {
			const e = err instanceof Error ? err : new Error(String(err));
			captureError({
				severity: "critical",
				errorType: "wizard_framework",
				errorSrc: "wizard:framework",
				message: e.message,
				stack: e.stack,
			});
		}
		throw err;
	}

	return state;
}
