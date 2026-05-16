# Document Review Example

This example shows a local folder that can be turned into an AIWS document-review workspace.

## Try It

```bash
aiws init --root ~/.ai-workspace
aiws project create "Document Review" --root ~/.ai-workspace --owner local --visibility private
```

Copy this folder's `aiws.yaml` and `notes/` into the project folder, then open AIWS and run the `summarize_docs` action.

Expected output:

- A markdown document summary.
- A run record.
- A context receipt showing which files were used.
