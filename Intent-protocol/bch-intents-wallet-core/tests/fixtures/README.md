# Test fixtures

`solana-tx.json` holds reference Solana transactions built with `@solana/web3.js`: a legacy transaction with two
signers and a v0 transaction with one, unsigned and signed. `make-solana-tx.cjs` is the script that produced it; it
loads web3.js from the browser extension's install next door (`node tests/fixtures/make-solana-tx.cjs > tests/fixtures/solana-tx.json`).
The keys are derived from fixed seeds and hold nothing.
