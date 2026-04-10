import { execSync } from "node:child_process";
import fs from "node:fs";
import type { SkillHandler } from "./executor.js";

/**
 * Image-edit skill.
 * Uses sharp for image processing. Falls back to error if sharp not available.
 * Operations: resize, crop, convert, EXIF strip, watermark.
 */
export const imageEditHandler: SkillHandler = async (args, _ctx) => {
	const source = args.source as string | undefined;
	const prompt = args.prompt as string | undefined;
	const outputPath = args.output_path as string | undefined;
	const options = args.options as Record<string, unknown> | undefined;

	if (!source && !prompt) {
		return { success: false, data: null, error: "Missing source file path or prompt" };
	}

	// Check if source exists for file operations
	if (source && !fs.existsSync(source)) {
		return { success: false, data: null, error: `Source file not found: ${source}` };
	}

	try {
		const sharp = await import("sharp");
		if (!source) {
			return { success: false, data: null, error: "Image generation requires source file" };
		}

		let pipeline = sharp.default(source);
		const operation = (options?.operation as string) ?? "info";

		switch (operation) {
			case "resize": {
				const width = options?.width as number | undefined;
				const height = options?.height as number | undefined;
				pipeline = pipeline.resize(width, height);
				break;
			}
			case "grayscale":
				pipeline = pipeline.grayscale();
				break;
			case "blur":
				pipeline = pipeline.blur((options?.sigma as number) ?? 3);
				break;
			case "strip-exif":
				pipeline = pipeline.rotate(); // rotate() strips EXIF
				break;
			case "convert": {
				const format = (options?.format as string) ?? "png";
				pipeline = pipeline.toFormat(format as "png" | "jpeg" | "webp" | "avif");
				break;
			}
			case "info": {
				const metadata = await sharp.default(source).metadata();
				return { success: true, data: { metadata } };
			}
			default:
				return { success: false, data: null, error: `Unknown operation: ${operation}` };
		}

		const output = outputPath ?? source.replace(/\.[^.]+$/, "-processed.png");
		await pipeline.toFile(output);
		return { success: true, data: { output_path: output, operation } };
	} catch (err) {
		return {
			success: false,
			data: null,
			error: `Image processing failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
};

/**
 * Video-edit skill.
 * Shells out to ffmpeg. Operations: convert, trim, concat, frame extract.
 */
export const videoEditHandler: SkillHandler = async (args, _ctx) => {
	const source = args.source as string | undefined;
	const options = args.options as Record<string, unknown> | undefined;
	const outputPath = args.output_path as string | undefined;
	const operation = (options?.operation as string) ?? "info";

	if (!source) {
		return { success: false, data: null, error: "Missing source file path" };
	}

	if (!fs.existsSync(source)) {
		return { success: false, data: null, error: `Source file not found: ${source}` };
	}

	// Check ffmpeg availability
	try {
		execSync("ffmpeg -version", { stdio: "pipe" });
	} catch {
		return {
			success: false,
			data: null,
			error: "ffmpeg not found. Install ffmpeg to use video-edit.",
		};
	}

	const output = outputPath ?? source.replace(/\.[^.]+$/, "-output.mp4");

	try {
		switch (operation) {
			case "info": {
				const info = execSync(
					`ffprobe -v quiet -print_format json -show_format -show_streams "${source}"`,
					{ encoding: "utf-8" },
				);
				return { success: true, data: JSON.parse(info) };
			}
			case "convert": {
				const format = (options?.format as string) ?? "mp4";
				const out = outputPath ?? source.replace(/\.[^.]+$/, `.${format}`);
				execSync(`ffmpeg -y -i "${source}" "${out}"`, { stdio: "pipe" });
				return { success: true, data: { output_path: out, operation: "convert" } };
			}
			case "trim": {
				const start = (options?.start as string) ?? "00:00:00";
				const duration = (options?.duration as string) ?? "00:00:10";
				execSync(`ffmpeg -y -i "${source}" -ss ${start} -t ${duration} -c copy "${output}"`, {
					stdio: "pipe",
				});
				return { success: true, data: { output_path: output, operation: "trim" } };
			}
			case "extract-frame": {
				const timestamp = (options?.timestamp as string) ?? "00:00:01";
				const out = outputPath ?? source.replace(/\.[^.]+$/, "-frame.png");
				execSync(`ffmpeg -y -i "${source}" -ss ${timestamp} -vframes 1 "${out}"`, {
					stdio: "pipe",
				});
				return { success: true, data: { output_path: out, operation: "extract-frame" } };
			}
			case "strip-metadata": {
				execSync(`ffmpeg -y -i "${source}" -map_metadata -1 -c copy "${output}"`, {
					stdio: "pipe",
				});
				return { success: true, data: { output_path: output, operation: "strip-metadata" } };
			}
			default:
				return { success: false, data: null, error: `Unknown video operation: ${operation}` };
		}
	} catch (err) {
		return {
			success: false,
			data: null,
			error: `ffmpeg failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
};

/**
 * Audio-edit skill.
 * Uses ffmpeg for editing, delegates transcription to whisper-local MCP.
 */
export const audioEditHandler: SkillHandler = async (args, _ctx) => {
	const source = args.source as string | undefined;
	const options = args.options as Record<string, unknown> | undefined;
	const outputPath = args.output_path as string | undefined;
	const operation = (options?.operation as string) ?? "info";

	if (!source) {
		return { success: false, data: null, error: "Missing source file path" };
	}

	if (!fs.existsSync(source)) {
		return { success: false, data: null, error: `Source file not found: ${source}` };
	}

	if (operation === "transcribe") {
		// Delegate to whisper-local MCP
		return {
			success: true,
			data: {
				status: "mcp_delegation",
				target: "whisper-local",
				message:
					"Transcription requires whisper-local MCP. Connect it to enable audio transcription.",
			},
		};
	}

	// Check ffmpeg availability
	try {
		execSync("ffmpeg -version", { stdio: "pipe" });
	} catch {
		return {
			success: false,
			data: null,
			error: "ffmpeg not found. Install ffmpeg to use audio-edit.",
		};
	}

	const output = outputPath ?? source.replace(/\.[^.]+$/, "-output.mp3");

	try {
		switch (operation) {
			case "info": {
				const info = execSync(
					`ffprobe -v quiet -print_format json -show_format -show_streams "${source}"`,
					{ encoding: "utf-8" },
				);
				return { success: true, data: JSON.parse(info) };
			}
			case "convert": {
				const format = (options?.format as string) ?? "mp3";
				const out = outputPath ?? source.replace(/\.[^.]+$/, `.${format}`);
				execSync(`ffmpeg -y -i "${source}" "${out}"`, { stdio: "pipe" });
				return { success: true, data: { output_path: out, operation: "convert" } };
			}
			case "trim": {
				const start = (options?.start as string) ?? "00:00:00";
				const duration = (options?.duration as string) ?? "00:00:10";
				execSync(`ffmpeg -y -i "${source}" -ss ${start} -t ${duration} -c copy "${output}"`, {
					stdio: "pipe",
				});
				return { success: true, data: { output_path: output, operation: "trim" } };
			}
			case "normalize": {
				execSync(`ffmpeg -y -i "${source}" -af loudnorm "${output}"`, { stdio: "pipe" });
				return { success: true, data: { output_path: output, operation: "normalize" } };
			}
			default:
				return { success: false, data: null, error: `Unknown audio operation: ${operation}` };
		}
	} catch (err) {
		return {
			success: false,
			data: null,
			error: `ffmpeg failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
};
