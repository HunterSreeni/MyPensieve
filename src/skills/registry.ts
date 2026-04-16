import { dailyLogHandler } from "./daily-log.js";
import { SkillRegistry } from "./executor.js";
import { audioEditHandler, imageEditHandler, videoEditHandler } from "./media.js";
import { memoryExtractHandler } from "./memory-extract.js";
import { memoryRecallHandler } from "./memory-recall.js";
import { researcherHandler } from "./researcher.js";
import { blogSeoHandler, cveMonitorHandler, playwrightCliHandler } from "./security.js";

/**
 * Create and populate the default skill registry with all 9 MVP skills.
 */
export function createDefaultRegistry(): SkillRegistry {
	const registry = new SkillRegistry();

	// Core skills
	registry.register("daily-log", dailyLogHandler);
	registry.register("memory-recall", memoryRecallHandler);
	registry.register("memory-extract", memoryExtractHandler);
	registry.register("researcher", researcherHandler);

	// Media skills
	registry.register("image-edit", imageEditHandler);
	registry.register("video-edit", videoEditHandler);
	registry.register("audio-edit", audioEditHandler);

	// Security & content skills
	registry.register("cve-monitor", cveMonitorHandler);
	registry.register("blog-seo", blogSeoHandler);
	registry.register("playwright-cli", playwrightCliHandler);

	return registry;
}
