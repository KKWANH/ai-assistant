# CSV Analysis Example

This example demonstrates deterministic table profiling before any LLM summary.

## Try It

Attach `data/sample.csv` from the AIWS Home Workbench and run **Analyze table**.

Expected artifacts:

- `csv-profile.json`
- `csv-preview.csv`
- `csv-summary.md`
- `numeric-stats.csv`

The context receipt should say whether raw CSV text or only a computed profile was sent to the selected model.
