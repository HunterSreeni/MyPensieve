import { describe, expect, it } from "vitest";
import { getProjectBinding } from "../../src/core/session.js";

describe("getProjectBinding", () => {
	it("generates cli binding from cwd", () => {
		const binding = getProjectBinding("cli", "/home/user/myproject");
		expect(binding).toBe("cli/home-user-myproject");
	});

	it("generates telegram binding from peer_id", () => {
		const binding = getProjectBinding("telegram", "12345678");
		expect(binding).toBe("telegram/12345678");
	});

	it("handles root path", () => {
		const binding = getProjectBinding("cli", "/");
		expect(binding).toBe("cli/");
	});

	it("replaces special characters with underscores", () => {
		const binding = getProjectBinding("cli", "/home/user/my project (2)");
		expect(binding).toBe("cli/home-user-my_project__2_");
	});

	it("handles nested paths", () => {
		const binding = getProjectBinding("cli", "/home/user/projects/foo/bar");
		expect(binding).toBe("cli/home-user-projects-foo-bar");
	});
});
