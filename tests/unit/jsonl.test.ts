import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	JsonlError,
	appendJsonl,
	appendJsonlBatch,
	countJsonl,
	queryJsonl,
	readJsonlStream,
	readJsonlSync,
	writeJsonlAtomic,
} from "../../src/utils/jsonl.js";

interface TestRecord {
	id: number;
	name: string;
	timestamp: string;
}

describe("JSONL utilities", () => {
	let tmpDir: string;
	let filePath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-jsonl-test-"));
		filePath = path.join(tmpDir, "test.jsonl");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("appendJsonl", () => {
		it("creates file and appends a record", () => {
			appendJsonl(filePath, { id: 1, name: "first" });
			const content = fs.readFileSync(filePath, "utf-8");
			expect(content).toBe('{"id":1,"name":"first"}\n');
		});

		it("appends multiple records", () => {
			appendJsonl(filePath, { id: 1 });
			appendJsonl(filePath, { id: 2 });
			const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
			expect(lines).toHaveLength(2);
		});

		it("creates parent directories", () => {
			const deepPath = path.join(tmpDir, "a", "b", "c", "test.jsonl");
			appendJsonl(deepPath, { id: 1 });
			expect(fs.existsSync(deepPath)).toBe(true);
		});
	});

	describe("appendJsonlBatch", () => {
		it("appends multiple records in a single write", () => {
			appendJsonlBatch(filePath, [{ id: 1 }, { id: 2 }, { id: 3 }]);
			const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
			expect(lines).toHaveLength(3);
		});

		it("does nothing for empty array", () => {
			appendJsonlBatch(filePath, []);
			expect(fs.existsSync(filePath)).toBe(false);
		});
	});

	describe("readJsonlSync", () => {
		it("returns empty array for nonexistent file", () => {
			const result = readJsonlSync("/nonexistent/file.jsonl");
			expect(result).toEqual([]);
		});

		it("parses all records", () => {
			appendJsonlBatch(filePath, [
				{ id: 1, name: "a", timestamp: "2026-01-01" },
				{ id: 2, name: "b", timestamp: "2026-01-02" },
			]);
			const result = readJsonlSync<TestRecord>(filePath);
			expect(result).toHaveLength(2);
			expect(result[0]?.name).toBe("a");
			expect(result[1]?.name).toBe("b");
		});

		it("skips blank lines", () => {
			fs.writeFileSync(filePath, '{"id":1}\n\n{"id":2}\n\n', "utf-8");
			const result = readJsonlSync(filePath);
			expect(result).toHaveLength(2);
		});

		it("throws on malformed JSON", () => {
			fs.writeFileSync(filePath, '{"id":1}\nnot json\n', "utf-8");
			expect(() => readJsonlSync(filePath)).toThrow(JsonlError);
		});
	});

	describe("readJsonlStream", () => {
		it("streams records", async () => {
			appendJsonlBatch(filePath, [{ id: 1 }, { id: 2 }, { id: 3 }]);
			const records: unknown[] = [];
			for await (const record of readJsonlStream(filePath)) {
				records.push(record);
			}
			expect(records).toHaveLength(3);
		});

		it("returns nothing for nonexistent file", async () => {
			const records: unknown[] = [];
			for await (const record of readJsonlStream("/nonexistent")) {
				records.push(record);
			}
			expect(records).toEqual([]);
		});
	});

	describe("queryJsonl", () => {
		it("filters records", () => {
			appendJsonlBatch(filePath, [
				{ id: 1, name: "alpha" },
				{ id: 2, name: "beta" },
				{ id: 3, name: "alpha" },
			]);
			const result = queryJsonl<{ id: number; name: string }>(filePath, (r) => r.name === "alpha");
			expect(result).toHaveLength(2);
		});
	});

	describe("countJsonl", () => {
		it("counts all records without filter", () => {
			appendJsonlBatch(filePath, [{ id: 1 }, { id: 2 }, { id: 3 }]);
			expect(countJsonl(filePath)).toBe(3);
		});

		it("counts filtered records", () => {
			appendJsonlBatch(filePath, [{ id: 1 }, { id: 2 }, { id: 3 }]);
			expect(countJsonl<{ id: number }>(filePath, (r) => r.id > 1)).toBe(2);
		});
	});

	describe("writeJsonlAtomic", () => {
		it("writes records atomically", () => {
			writeJsonlAtomic(filePath, [{ id: 1 }, { id: 2 }]);
			const result = readJsonlSync(filePath);
			expect(result).toHaveLength(2);
		});

		it("overwrites existing file", () => {
			appendJsonlBatch(filePath, [{ id: 1 }, { id: 2 }, { id: 3 }]);
			writeJsonlAtomic(filePath, [{ id: 99 }]);
			const result = readJsonlSync(filePath);
			expect(result).toHaveLength(1);
		});

		it("handles empty array", () => {
			writeJsonlAtomic(filePath, []);
			const content = fs.readFileSync(filePath, "utf-8");
			expect(content).toBe("");
		});
	});
});
