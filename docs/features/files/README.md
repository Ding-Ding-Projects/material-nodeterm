# Files and media

File operations are split into two layers:

- [File converter](../../file-converter.md) covers bounded one-input/one-output conversion,
  structured data, text encodings, binary encodings, gzip, and Brotli.
- [Advanced media pipelines](./advanced-media.md) covers archive containers, PDF inspection and
  text extraction, image metadata, media probing, and OCR. Operations that need an external binary
  remain disabled until that binary is present in the verified application tool manifest.

Both layers keep source files unchanged, publish outputs atomically, and report partial results.

