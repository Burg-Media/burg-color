# Notice

Burg Color is Copyright (c) 2026 Burg Media and released under the MIT License (see [LICENSE](LICENSE)).

All JavaScript, HTML and CSS in this repository was written by Burg Media. There are no third-party libraries, no bundler and no minified code. The MIT License does not apply to the third-party components below; they keep their own licenses.

## Fonts: `fonts/`

- **Geist** (`geist-latin.woff2`) and **Geist Mono** (`geist-mono-latin.woff2`), Copyright 2024 The Geist Project Authors, https://github.com/vercel/geist-font
- License: SIL Open Font License 1.1, full text in [`fonts/LICENSE-Geist-OFL.txt`](fonts/LICENSE-Geist-OFL.txt).

## Formulas and specifications

These are implemented in Burg Media's own code; no third-party code is included.

- **OKLab / OKLCH conversion** in `lib/color.js` uses the matrices published by Björn Ottosson, https://bottosson.github.io/posts/oklab/ (the author places that code in the public domain, with the MIT License as an alternative).
- **Contrast ratio and relative luminance** in `lib/color.js` follow the W3C Web Content Accessibility Guidelines (WCAG) 2 definitions.
- **sRGB, HSL and HSV conversions** follow the formulas in the CSS Color specification.
