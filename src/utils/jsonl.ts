import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export class JsonlError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "JsonlError";
	}
}

/**
 * Append a single record to a JSONL file.
 * Creates the file and parent directories if they don't exist.
 * Atomic: writes are newline-terminated to prevent partial records.
 */
export function appendJsonl<T>(filePath: string, record: T): void {
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const line = `${JSON.stringify(record)}\n`;
		fs.appendFileSync(filePath, line, "utf-8");
	} catch (err) {
		throw new JsonlError(`Failed to append to ${filePath}`, err);
	}
}

/**
 * Append multiple records to a JSONL file in a single write.
 * More efficient than calling appendJsonl in a loop.
 */
export function appendJsonlBatch<T>(filePath: string, records: T[]): void {
	if (records.length === 0) return;
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const lines = `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
		fs.appendFileSync(filePath, lines, "utf-8");
	} catch (err) {
		throw new JsonlError(`Failed to batch append to ${filePath}`, err);
	}
}

/**
 * Read all records from a JSONL file synchronously.
 * Returns an empty array if the file doesn't exist.
 * Skips blank lines. Throws on malformed JSON lines.
 */
export function readJsonlSync<T>(filePath: string): T[] {
	if (!fs.existsSync(filePath)) return [];

	const content = fs.readFileSync(filePath, "utf-8");
	const lines = content.split("\n");
	const records: T[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]?.trim();
		if (!line) continue;
		try {
			records.push(JSON.parse(line) as T);
		} catch (err) {
			throw new JsonlError(`Malformed JSON at ${filePath}:${i + 1}`, err);
		}
	}

	return records;
}

/**
 * Stream records from a JSONL file line by line.
 * Memory-efficient for large files.
 * Returns an async iterable of parsed records.
 */
export async function* readJsonlStream<T>(filePath: string): AsyncGenerator<T> {
	if (!fs.existsSync(filePath)) return;

	const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
	const rl = readline.createInterface({ input: fileStream, crlfDelay: Number.POSITIVE_INFINITY });

	let lineNum = 0;
	for await (const line of rl) {
		lineNum++;
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			yield JSON.parse(trimmed) as T;
		} catch (err) {
			throw new JsonlError(`Malformed JSON at ${filePath}:${lineNum}`, err);
		}
	}
}

/**
 * Query JSONL records with a filter function.
 * Reads the entire file - use readJsonlStream for large files.
 */
export function queryJsonl<T>(filePath: string, filter: (record: T) => boolean): T[] {
	return readJsonlSync<T>(filePath).filter(filter);
}

/**
 * Count records in a JSONL file matching an optional filter.
 */
export function countJsonl<T>(filePath: string, filter?: (record: T) => boolean): number {
	const records = readJsonlSync<T>(filePath);
	return filter ? records.filter(filter).length : records.length;
}

/**
 * Write a JSONL file atomically (temp + rename).
 * Used for rewriting/compacting files.
 */
export function writeJsonlAtomic<T>(filePath: string, records: T[]): void {
	const dir = path.dirname(filePath);
	const tmpPath = path.join(dir, `.jsonl-${crypto.randomUUID()}.tmp`);

	try {
		fs.mkdirSync(dir, { recursive: true });
		const content =
			records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");
		fs.writeFileSync(tmpPath, content, "utf-8");
		fs.renameSync(tmpPath, filePath);
	} catch (err) {
		try {
			fs.unlinkSync(tmpPath);
		} catch {
			// Ignore cleanup errors
		}
		throw new JsonlError(`Failed to atomically write ${filePath}`, err);
	}
}
