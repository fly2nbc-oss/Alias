# Third-party components

The built file `alias.html` contains these libraries. `npm run build` bundles them from the npm packages. The Apache License 2.0 is in [`LICENSE`](./LICENSE); the MIT license texts are at the end of this file.

| Component | Version | License | Copyright | Source | License text |
|---|---|---|---|---|---|
| Transformers.js (`@huggingface/transformers`) | 4.3.2 | Apache-2.0 | Hugging Face | https://github.com/huggingface/transformers.js | [`LICENSE`](./LICENSE) |
| `@huggingface/tokenizers` | 0.2.0 | Apache-2.0 | Hugging Face | https://github.com/huggingface/tokenizers.js | [`LICENSE`](./LICENSE) |
| `@huggingface/jinja` | 0.5.11 | MIT | (c) 2023 Hugging Face | https://github.com/huggingface/huggingface.js | [below](#mit-license) |
| ONNX Runtime Web (`onnxruntime-web`, with `onnxruntime-common` and the WebAssembly runtime) | 1.31.0-dev | MIT | (c) Microsoft Corporation | https://github.com/microsoft/onnxruntime | [below](#mit-license) |
| PDF.js (`pdfjs-dist`) | 6.5.438 | Apache-2.0 | Mozilla Foundation | https://github.com/mozilla/pdf.js | [`LICENSE`](./LICENSE) |
| SheetJS Community Edition (`xlsx`) | 0.20.3 | Apache-2.0 | SheetJS LLC | https://sheetjs.com | [`LICENSE`](./LICENSE) |
| fflate | 0.8.3 | MIT | (c) Arjun Barrett | https://github.com/101arrowz/fflate | [below](#mit-license) |

Dependencies of ONNX Runtime Web that may end up in the bundle: `flatbuffers` (Apache-2.0), `long` (Apache-2.0), `protobufjs` (BSD-3-Clause), `guid-typescript` (ISC), `platform` (MIT).

## AI model (not bundled)

Alias does not ship the model. On first use, the browser downloads it once from Hugging Face and keeps it in its cache.

| Model | License | Source |
|---|---|---|
| `Xenova/bert-base-multilingual-cased-ner-hrl` – ONNX conversion of the model below for Transformers.js, quantized (q8) | none declared on the model card | https://huggingface.co/Xenova/bert-base-multilingual-cased-ner-hrl |
| `Davlan/bert-base-multilingual-cased-ner-hrl` – the original model | AFL-3.0 (Academic Free License 3.0), as declared on the model card | https://huggingface.co/Davlan/bert-base-multilingual-cased-ner-hrl |

Alias pins revision `263e82c06569c8c2ac46238a7ae5107598934234` of the converted model and checks every downloaded file against its SHA-256 (`src/core/ner/integrity.ts`).

The original model is fine-tuned from Google's `bert-base-multilingual-cased` (Apache-2.0) on CoNLL 2002/2003, ANERcorp, Europeana Newspapers, I-CAB, Latvian NER, Paramopama + Second HAREM and MSRA.

## Trademarks

Microsoft, Word, Excel, PowerPoint and Edge are trademarks of Microsoft Corporation. They are named only to describe file and browser compatibility. This project is not affiliated with Microsoft.

## License texts

### MIT License

Applies to `@huggingface/jinja`, ONNX Runtime Web and fflate:

```text
MIT License

Copyright (c) 2023 Hugging Face (@huggingface/jinja)
Copyright (c) Microsoft Corporation (ONNX Runtime Web)
Copyright (c) 2026 Arjun Barrett (fflate)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
