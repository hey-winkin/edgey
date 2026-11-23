# Purchase order PDF fonts

These are the unmodified TrueType Regular and Bold weights from the official releases:

- [Inter 4.1](https://github.com/rsms/inter/releases/tag/v4.1), from `extras/ttf`.
- [IBM Plex Mono 2.5.0](https://github.com/IBM/plex/releases/tag/%40ibm%2Fplex-mono%402.5.0), from `fonts/complete/ttf`.

Each family has its upstream SIL Open Font License (OFL 1.1) in its directory. The PDF renderer embeds only the glyphs it uses; these files are not served to the browser.

The renderer uses jsPDF's TrueType glyph map to check character coverage and gives each embedded subset a PDF subset name. When upgrading jsPDF, rerun the text-extraction tests and use `pdffonts` to confirm the faces remain embedded, subsetted and Unicode-mapped.
