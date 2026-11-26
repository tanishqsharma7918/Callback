# Third-party software and fonts

Callback bundles these open-source components, unmodified (in `lib/` and `fonts/` in the folder layout, side by side
with the app files in the flat GitHub layout):

| Component | Version | License | Source |
|---|---|---|---|
| Three.js | r128 | MIT | https://github.com/mrdoob/three.js |
| Three.js examples (only the add-ons the app loads, e.g. RoomEnvironment, RoundedBoxGeometry, USDZExporter, fflate) | r128 | MIT | https://github.com/mrdoob/three.js/tree/r128/examples/js |
| ExcelJS | 4.4.0 | MIT | https://github.com/exceljs/exceljs |
| JSZip | 3.10.1 | MIT (or GPLv3, at your option) | https://github.com/Stuk/jszip |
| PDF.js | 3.11.174 | Apache License 2.0 | https://github.com/mozilla/pdf.js |
| Mammoth | 1.6.0 | BSD 2-Clause | https://github.com/mwilliamson/mammoth.js |
| Bodoni Moda (variable: optical size 6–96, weight 400–900, italic) | Google Fonts v28 | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Bodoni+Moda · https://github.com/indestructible-type/Bodoni |
| Geist (variable: weight 300–700) | Google Fonts v5 | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Geist · https://github.com/vercel/geist-font |
| Geist Mono (variable: weight 400–600) | Google Fonts v6 | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Geist+Mono · https://github.com/vercel/geist-font |

The full license texts are available at the source links above. The fonts are embedded in `fonts.css` as
woff2 data (Latin and Latin Extended subsets only), so they also work offline and when `index.html` is opened from disk.
The SIL Open Font License allows bundling the fonts with software; they may not be sold on their own.
