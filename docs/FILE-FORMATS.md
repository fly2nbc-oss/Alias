# File formats

Alias opens a file, shows its text for **Find names**, and saves a copy with the names hidden (placeholders). When the AI sends back a file, Alias opens it in *2 · AI's answer* and saves a copy with the real names brought back. The original file is never changed.

## What Alias opens and saves

| Format | Open | Save a copy |
|---|---|---|
| Word `.docx` `.docm`, Excel `.xlsx` `.xlsm`, PowerPoint `.pptx` `.pptm` | ✓ | ✓ same format |
| OpenDocument `.odt` `.ods` `.odp` | ✓ | ✓ same format |
| Text: `.txt` `.md` `.csv` `.tsv` `.log` `.json` `.xml` `.html` `.yaml` `.toml` `.ini` `.cfg` `.conf` `.properties` `.sql` `.eml` | ✓ | ✓ same format, encoding and line endings |
| PDF (text layer only, no OCR), legacy Excel `.xls` | ✓ | as `.txt` only |

Not supported: legacy Word `.doc` and PowerPoint `.ppt`, and password-protected files.

The copy is named after the original with `_anonym` (names hidden, **Save file for AI**) or `_original` (names brought back, **Save file** in step 2); the opposite suffix is replaced, so `Contract_anonym.docx` comes back as `Contract_original.docx`. Names in the file name are hidden and brought back too: `Contract_Max_Mustermann.docx` becomes `Contract_Person-1_anonym.docx`. In Edge and Chrome a *Save as* dialog asks where to put it, other browsers download it.

## Files from the AI

The AI's file can be in any format Alias opens, not only the one you gave it; a copy with the real names is written for the formats in the table above, other files (PDF, `.xls`) are saved as text. Alias replaces placeholders in any capitalization and also when Word split one over two formatting runs. A placeholder the AI wrote differently, such as `Person 1` or `Person_1` for `Person-1`, is not replaced: the status bar counts them, and after saving it also counts placeholders that were shown but not found in the file. Bringing names back does not clean metadata; the author and dates the AI tool wrote stay in the file.

## Office files

Alias works on the text and leaves formatting, images and layout alone. Parts of the file it does not change are copied byte for byte.

The text shown in Alias contains everything that is replaced in the copy, so **Find names** can find it: body, headers and footers, footnotes, comments, tracked deletions, text boxes, charts, SmartArt, slide masters, formulas, alt texts, links and document properties.

## Cleanup when hiding names

A copy with hidden names is also cleaned of what identifies the author or the source:

- **Removed**: author, last editor, company, manager, dates, template path, mail-merge source, custom properties, the people list, the thumbnail image, and JPEG metadata (EXIF/XMP).
- **Replaced**: comment and revision authors become "Author"; names in alt texts, field codes, hyperlink targets, formulas, chart and pivot caches and embedded Office files are hidden like in the text.
- **Excel sheet names** are renamed consistently in formulas, names and charts.

After saving, Alias lists what it removed and warns about anything it could not check. It also warns when a term shown in Alias was not replaced in the file, for example in Excel date cells.

## Check before sharing

Alias does not cover these. Look at the copy before you pass it on:

- **Text inside images** – there is no OCR.
- **OLE objects and other binary embeddings** – reported, not changed.
- **VBA macros** – reported, not changed.
- **Tracked changes** are not accepted: their text is replaced, but they stay tracked changes.
- **OpenDocument spreadsheet sheet names** – reported, not renamed.
