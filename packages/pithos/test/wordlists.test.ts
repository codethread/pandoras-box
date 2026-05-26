import { get_encoding } from "tiktoken";
import { describe, expect, it } from "vitest";
import { friendlyIdWords } from "../src/wordlists/index.js";

describe("friendly ID wordlists", () => {
	it("only contains words that are at most two OpenAI tokens", () => {
		const encoding = get_encoding("o200k_base");
		try {
			expect(
				encoding.encode("yo-yo"),
				"tokeniser rules have changed, reconsider assumptions about word length to keep ids token friendly",
			).toHaveLength(3);

			const overTokenizedWords = friendlyIdWords
				.map((word) => ({ word, tokenCount: encoding.encode(word).length }))
				.filter(({ tokenCount }) => tokenCount > 2);

			expect(overTokenizedWords).toEqual([]);
		} finally {
			encoding.free();
		}
	});
});
