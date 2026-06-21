import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		reporters: ["dot"],
		name: "fagent",
		include: ["test/**/*.test.ts", "src/**/*.test.ts"],
		pool: "threads",
		testTimeout: 2000,
		globalSetup: ["../../vitest.global-setup.ts"],
	},
});
