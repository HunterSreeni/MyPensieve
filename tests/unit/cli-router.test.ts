import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerCommand, getCommand, getAllCommands, dispatch } from "../../src/cli/router.js";

describe("CLI router", () => {
	it("registers and retrieves a command", () => {
		registerCommand({
			name: "test-cmd",
			description: "A test command",
			usage: "mypensieve test-cmd",
			run: async () => {},
		});
		expect(getCommand("test-cmd")).toBeDefined();
		expect(getCommand("test-cmd")?.description).toBe("A test command");
	});

	it("returns undefined for unknown command", () => {
		expect(getCommand("nonexistent-xyz")).toBeUndefined();
	});

	it("lists all registered commands", () => {
		const before = getAllCommands().length;
		registerCommand({
			name: `list-test-${Date.now()}`,
			description: "temp",
			usage: "temp",
			run: async () => {},
		});
		expect(getAllCommands().length).toBe(before + 1);
	});

	it("dispatches to correct handler", async () => {
		const handler = vi.fn();
		registerCommand({
			name: "dispatch-test",
			description: "test",
			usage: "test",
			run: handler,
		});
		await dispatch(["dispatch-test", "arg1", "arg2"]);
		expect(handler).toHaveBeenCalledWith(["arg1", "arg2"]);
	});

	it("handles --help flag", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await dispatch(["--help"]);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("handles --version flag", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await dispatch(["--version"]);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("mypensieve"));
		spy.mockRestore();
	});

	it("handles unknown command gracefully", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await dispatch(["totally-unknown-command"]);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("Unknown command"));
		spy.mockRestore();
	});
});
