# EFF Short Wordlist

`eff-short.json` is derived from the [EFF Short Wordlist #1](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) published by the Electronic Frontier Foundation.

- 1391 lowercase words, alphabetised
- Used to generate human-friendly IDs: `task_pear-orange-tree`, `run_fish-butter-clam`
- Removes words that are unpleasant or exceed two `o200k_base` OpenAI tokens
- Includes extra single-token programming terms such as `async`, `cache`, `json`, and `schema`

Check candidate words with:

```sh
pnpm --filter @pdx/pithos check-word-tokens -- --max 1 async cache schema
```

## License

The EFF Short Wordlist is released under [Creative Commons Attribution 3.0 (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/).

Source: https://www.eff.org/files/2016/09/08/eff_short_wordlist_1.txt  
Author: Electronic Frontier Foundation (EFF)
