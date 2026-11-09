/**
 * Leak tests: after encoding, no original (names, email, company, path) may remain in any
 * ZIP entry (decompressed, also .rels and binary data, recursively in embedded documents) or
 * in the file name. Also: everything that is replaced is visible in the shown text, and
 * decoding restores the shown text.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { AliasEntry } from '../types';
import { makeCopy } from './file-copy';
import { outputName } from './formats';
import { parseFile } from './parsers';
import { stripJpegMetadata } from './sanitize';
import { pairs } from './substitute';
import { rewriteFormula } from './xlsx-formula';

// ---------------------------------------------------------------- Terms

/** Each term appears in the fixture in exactly one "hidden" place (given in the comment) */
const TERMS: [string, string][] = [
  ['Max Mustermann', 'Person-1'], // body text, file name, header
  ['Erika Musterfrau', 'Person-2'], // only as author (comment, tracked change, properties) -> removed
  ['Hans Geheimnis', 'Person-3'], // deleted text, comment, sheet name
  ['Geheim GmbH', 'Company-1'], // company, template path
  ['max.mustermann@geheim.de', 'Email-1'], // field code
  ['erika.musterfrau@geheim.de', 'Email-2'], // only in people.xml / persons -> removed
  ['Fritz Fussnote', 'Person-4'], // only in a footnote
  ['Anna Alttext', 'Person-5'], // only in the alt text
  ['Lars Link', 'Person-6'], // only in the hyperlink target
  ['Tina Titel', 'Person-7'], // only in the document title
  ['Dora Diagramm', 'Person-8'], // only in the chart cache
  ['Eva Eingebettet', 'Person-9'], // only in an embedded workbook
  ['Karl Kopfzeile', 'Person-10'], // xlsx header/footer
  ['Frieda Formel', 'Person-11'], // xlsx formula literal
  ['Theo Textfeld', 'Person-12'], // text box (drawing)
  ['Mona Master', 'Person-13'], // pptx slide master
  ['Bernd Bild', 'Person-14'], // only in the EXIF of a JPEG -> removed
  ['Sven SmartArt', 'Person-15'], // pptx SmartArt data
];
/** Extra traces that are not terms but must disappear (paths, company field) */
const TRACES = ['C:/Users/max', 'C:\\Users\\max', 'Geheim%20GmbH', 'thumbnail'];

const entries: AliasEntry[] = TERMS.map(([original, alias], i) => ({ id: String(i), original, alias, category: 'person', confirmed: true }));
const ENC = pairs(entries, 'encode');
const DEC = pairs(entries, 'decode');

// ---------------------------------------------------------------- Helpers

const NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const RELS = (rels: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
const REL = (id: string, type: string, target: string, external = false) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;
const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Vertrag Tina Titel</dc:title><dc:creator>Erika Musterfrau</dc:creator><cp:lastModifiedBy>Erika Musterfrau</cp:lastModifiedBy><cp:category>Geheim GmbH intern</cp:category><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-02T00:00:00Z</dcterms:modified></cp:coreProperties>`;
const APP = (titles: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Template>Normal.dotm</Template><Company>Geheim GmbH</Company><Manager>Erika Musterfrau</Manager><TitlesOfParts><vt:vector size="${titles.length}" baseType="lpstr">${titles.map((t) => `<vt:lpstr>${t}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts><HyperlinkBase>C:\\Users\\max\\Geheim GmbH</HyperlinkBase></Properties>`;
const CUSTOM = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Kunde"><vt:lpwstr>Erika Musterfrau</vt:lpwstr></property></Properties>`;
const OVERRIDE = (part: string, type: string) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-${type}"/>`;
const PKG_RELS = (main: string, mainType = 'officeDocument') =>
  RELS(
    REL('rId1', mainType, main) +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      REL('rId3', 'extended-properties', 'docProps/app.xml') +
      REL('rId4', 'custom-properties', 'docProps/custom.xml') +
      '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>',
  );
const COMMON_CT =
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  OVERRIDE('docProps/app.xml', 'officedocument.extended-properties+xml') +
  OVERRIDE('docProps/custom.xml', 'officedocument.custom-properties+xml');
const TYPES = (overrides: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${COMMON_CT}${overrides}</Types>`;

/** JPEG with EXIF (Artist) and orientation 6 */
function jpegWithExif(artist: string): Uint8Array {
  const a = [...strToU8(artist), 0];
  // TIFF (II): header, IFD with 2 entries: Orientation=6, Artist (ASCII, offset to the data)
  const ifdOff = 8;
  const dataOff = ifdOff + 2 + 2 * 12 + 4;
  const le16 = (n: number) => [n & 0xff, n >> 8];
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
  const tiff = [0x49, 0x49, 0x2a, 0, ...le32(ifdOff), ...le16(2), ...le16(0x0112), ...le16(3), ...le32(1), ...le16(6), 0, 0, ...le16(0x013b), ...le16(2), ...le32(a.length), ...le32(dataOff), ...le32(0), ...a];
  const app1 = [...strToU8('Exif'), 0, 0, ...tiff];
  const seg = [0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1];
  const app0 = [0xff, 0xe0, 0, 16, ...strToU8('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...seg, 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);
}

/** Minimal workbook (embedded or standalone) */
function xlsxBytes(opts: { sheet: string; cell: string; extra?: Record<string, string> }): Uint8Array {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zipSync({
    '[Content_Types].xml': strToU8(
      TYPES(
        OVERRIDE('xl/workbook.xml', 'officedocument.spreadsheetml.sheet.main+xml') +
          OVERRIDE('xl/worksheets/sheet1.xml', 'officedocument.spreadsheetml.worksheet+xml') +
          OVERRIDE('xl/sharedStrings.xml', 'officedocument.spreadsheetml.sharedStrings+xml'),
      ),
    ),
    '_rels/.rels': strToU8(RELS(REL('rId1', 'officeDocument', 'xl/workbook.xml'))),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS}><sheets><sheet name="${opts.sheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(RELS(REL('rId1', 'worksheet', 'worksheets/sheet1.xml') + REL('rId2', 'sharedStrings', 'sharedStrings.xml'))),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst ${NS} count="1" uniqueCount="1"><si><t>${opts.cell}</t></si></sst>`),
    ...Object.fromEntries(Object.entries(opts.extra ?? {}).map(([k, v]) => [k, strToU8(v)])),
  });
}

function docxFixture(): Uint8Array {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS_W}><w:body>
<w:p><w:r><w:t>Vertrag mit Max Mustermann von der Geheim GmbH.</w:t></w:r></w:p>
<w:p><w:ins w:id="1" w:author="Erika Musterfrau" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Eingefügt.</w:t></w:r></w:ins><w:del w:id="2" w:author="Erika Musterfrau" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>Kunde Hans Geheimnis</w:delText></w:r></w:del></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:max.mustermann@geheim.de" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Kontakt</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Profil</w:t></w:r></w:hyperlink></w:p>
<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Bild 1" descr="Foto von Anna Alttext" title="Anna Alttext"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Anna Alttext.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId10"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
<w:sectPr><w:headerReference w:type="default" r:id="rId11"/></w:sectPr>
</w:body></w:document>`;
  const comments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${NS_W}><w:comment w:id="0" w:author="Erika Musterfrau" w:date="2026-01-01T00:00:00Z" w:initials="EM"><w:p><w:r><w:t>Bitte mit Hans Geheimnis klären</w:t></w:r></w:p></w:comment></w:comments>`;
  const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${NS_W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Quelle: Fritz Fussnote</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS_W}><w:p><w:r><w:t>Max Mustermann – vertraulich</w:t></w:r></w:p></w:hdr>`;
  const people = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Erika Musterfrau"><w15:presenceInfo w15:providerId="AD" w15:userId="erika.musterfrau@geheim.de"/></w15:person></w15:people>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS_W}><w:attachedTemplate r:id="rId1"/><w:defaultTabStop w:val="708"/></w:settings>`;
  const chart = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>Tabelle1!$A$2</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Dora Diagramm</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Tabelle1!$B$2</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1234</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      TYPES(
        OVERRIDE('word/document.xml', 'officedocument.wordprocessingml.document.main+xml') +
          OVERRIDE('word/comments.xml', 'officedocument.wordprocessingml.comments+xml') +
          OVERRIDE('word/footnotes.xml', 'officedocument.wordprocessingml.footnotes+xml') +
          OVERRIDE('word/header1.xml', 'officedocument.wordprocessingml.header+xml') +
          '<Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/>' +
          OVERRIDE('word/settings.xml', 'officedocument.wordprocessingml.settings+xml') +
          OVERRIDE('word/charts/chart1.xml', 'officedocument.drawingml.chart+xml') +
          '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>',
      ),
    ),
    '_rels/.rels': strToU8(PKG_RELS('word/document.xml')),
    'docProps/core.xml': strToU8(CORE),
    'docProps/app.xml': strToU8(APP(['Vertrag Tina Titel'])),
    'docProps/custom.xml': strToU8(CUSTOM),
    'docProps/thumbnail.jpeg': jpegWithExif('Max Mustermann'),
    'word/document.xml': strToU8(doc),
    'word/comments.xml': strToU8(comments),
    'word/footnotes.xml': strToU8(footnotes),
    'word/header1.xml': strToU8(header),
    'word/people.xml': strToU8(people),
    'word/settings.xml': strToU8(settings),
    'word/charts/chart1.xml': strToU8(chart),
    'word/_rels/document.xml.rels': strToU8(
      RELS(
        REL('rId1', 'settings', 'settings.xml') +
          REL('rId2', 'comments', 'comments.xml') +
          REL('rId3', 'footnotes', 'footnotes.xml') +
          '<Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/>' +
          REL('rId5', 'customXml', '../customXml/item1.xml') +
          REL('rId6', 'chart', 'charts/chart1.xml') +
          REL('rId9', 'hyperlink', 'https://intranet.example.com/people/Lars%20Link', true) +
          REL('rId10', 'image', 'media/image1.jpeg') +
          REL('rId11', 'header', 'header1.xml'),
      ),
    ),
    'word/_rels/settings.xml.rels': strToU8(RELS(REL('rId1', 'attachedTemplate', 'file:///C:/Users/max/Geheim%20GmbH/Vorlage.dotx', true))),
    'word/charts/_rels/chart1.xml.rels': strToU8(RELS(REL('rId1', 'package', '../embeddings/Microsoft_Excel_Worksheet.xlsx'))),
    'word/embeddings/Microsoft_Excel_Worksheet.xlsx': xlsxBytes({ sheet: 'Tabelle1', cell: 'Eva Eingebettet' }),
    'word/embeddings/oleObject1.bin': strToU8('OLE'),
    'word/media/image1.jpeg': jpegWithExif('Bernd Bild'),
    'customXml/item1.xml': strToU8('<?xml version="1.0"?><b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"><b:Source><b:Author>Erika Musterfrau</b:Author></b:Source></b:Sources>'),
    'customXml/itemProps1.xml': strToU8('<?xml version="1.0"?><ds:datastoreItem ds:itemID="{EF278816-EC6F-A645-907D-7F25AECB1D4A}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>'),
    'customXml/_rels/item1.xml.rels': strToU8(RELS(REL('rId1', 'customXmlProps', 'itemProps1.xml'))),
  };
  return zipSync(files);
}

function xlsxFixture(): Uint8Array {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>100</v></c><c r="C1" t="str"><f>"Frieda Formel"&amp;"!"</f><v>Frieda Formel!</v></c><c r="D1" t="str"><f>'Kunde Hans Geheimnis'!A1&amp;""</f><v>Max Mustermann</v></c><c r="E1"><f>SUM(Daten!B1:B2)</f><v>100</v></c></row>
</sheetData><hyperlinks><hyperlink ref="A1" location="'Kunde Hans Geheimnis'!A1" display="Max Mustermann"/></hyperlinks><headerFooter><oddHeader>&amp;LKarl Kopfzeile&amp;RSeite &amp;P</oddHeader></headerFooter><drawing r:id="rId1"/><legacyDrawing r:id="rId3"/></worksheet>`;
  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><sheetData><row r="1"><c r="B1"><v>100</v></c></row></sheetData></worksheet>`;
  const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="TextBox 1" descr="Anna Alttext"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:t>Theo Textfeld</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
  const comments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments ${NS}><authors><author>Erika Musterfrau</author><author>tc={1B4D3F7A-0000-0000-0000-000000000002}</author></authors><commentList><comment ref="A1" authorId="0"><text><r><t>Hans Geheimnis anrufen</t></r></text></comment></commentList></comments>`;
  const vml = `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape id="_x0000_s1025" type="#_x0000_t202" style="position:absolute;visibility:hidden"><v:textbox/><x:ClientData ObjectType="Note"><x:Row>0</x:Row><x:Column>0</x:Column></x:ClientData></v:shape></xml>`;
  const persons = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Erika Musterfrau" id="{1B4D3F7A-0000-0000-0000-000000000001}" userId="erika.musterfrau@geheim.de" providerId="AD"/></personList>`;
  const pivot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheDefinition ${NS} r:id="rId1" recordCount="1"><cacheSource type="worksheet"><worksheetSource ref="A1:B1" sheet="Kunde Hans Geheimnis"/></cacheSource><cacheFields count="1"><cacheField name="Kunde" numFmtId="0"><sharedItems count="1"><s v="Max Mustermann"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac" mc:Ignorable="x15ac"><fileVersion appName="xl"/><mc:AlternateContent><mc:Choice Requires="x15ac"><x15ac:absPath url="C:\\Users\\max\\Geheim GmbH\\"/></mc:Choice></mc:AlternateContent><sheets><sheet name="Kunde Hans Geheimnis" sheetId="1" r:id="rId1"/><sheet name="Daten" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Kunde Hans Geheimnis'!$A$1:$E$1</definedName></definedNames><pivotCaches><pivotCache cacheId="1" r:id="rId4"/></pivotCaches></workbook>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      TYPES(
        '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' +
          OVERRIDE('xl/workbook.xml', 'officedocument.spreadsheetml.sheet.main+xml') +
          OVERRIDE('xl/worksheets/sheet1.xml', 'officedocument.spreadsheetml.worksheet+xml') +
          OVERRIDE('xl/worksheets/sheet2.xml', 'officedocument.spreadsheetml.worksheet+xml') +
          OVERRIDE('xl/sharedStrings.xml', 'officedocument.spreadsheetml.sharedStrings+xml') +
          OVERRIDE('xl/drawings/drawing1.xml', 'officedocument.drawing+xml') +
          OVERRIDE('xl/comments1.xml', 'officedocument.spreadsheetml.comments+xml') +
          OVERRIDE('xl/pivotCache/pivotCacheDefinition1.xml', 'officedocument.spreadsheetml.pivotCacheDefinition+xml') +
          '<Override PartName="/xl/persons/person.xml" ContentType="application/vnd.ms-excel.person+xml"/>',
      ),
    ),
    '_rels/.rels': strToU8(PKG_RELS('xl/workbook.xml')),
    'docProps/core.xml': strToU8(CORE),
    'docProps/app.xml': strToU8(APP(['Kunde Hans Geheimnis', 'Daten', "'Kunde Hans Geheimnis'!Print_Area"])),
    'docProps/custom.xml': strToU8(CUSTOM),
    'docProps/thumbnail.jpeg': jpegWithExif('Max Mustermann'),
    'xl/workbook.xml': strToU8(wb),
    'xl/_rels/workbook.xml.rels': strToU8(
      RELS(
        REL('rId1', 'worksheet', 'worksheets/sheet1.xml') +
          REL('rId2', 'worksheet', 'worksheets/sheet2.xml') +
          REL('rId3', 'sharedStrings', 'sharedStrings.xml') +
          REL('rId4', 'pivotCacheDefinition', 'pivotCache/pivotCacheDefinition1.xml') +
          '<Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2017/10/relationships/person" Target="persons/person.xml"/>',
      ),
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/worksheets/sheet2.xml': strToU8(sheet2),
    'xl/worksheets/_rels/sheet1.xml.rels': strToU8(
      RELS(REL('rId1', 'drawing', '../drawings/drawing1.xml') + REL('rId2', 'comments', '../comments1.xml') + REL('rId3', 'vmlDrawing', '../drawings/vmlDrawing1.vml')),
    ),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst ${NS} count="1" uniqueCount="1"><si><t>Max Mustermann</t></si></sst>`),
    'xl/drawings/drawing1.xml': strToU8(drawing),
    'xl/drawings/vmlDrawing1.vml': strToU8(vml),
    'xl/comments1.xml': strToU8(comments),
    'xl/persons/person.xml': strToU8(persons),
    'xl/pivotCache/pivotCacheDefinition1.xml': strToU8(pivot),
  });
}

function pptxFixture(): Uint8Array {
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const sp = (text: string, descr = '') =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"${descr ? ` descr="${descr}"` : ''}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const tree = (inner: string) => `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree></p:cSld>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      TYPES(
        OVERRIDE('ppt/presentation.xml', 'officedocument.presentationml.presentation.main+xml') +
          OVERRIDE('ppt/slides/slide1.xml', 'officedocument.presentationml.slide+xml') +
          OVERRIDE('ppt/slideMasters/slideMaster1.xml', 'officedocument.presentationml.slideMaster+xml') +
          OVERRIDE('ppt/comments/comment1.xml', 'officedocument.presentationml.comments+xml') +
          OVERRIDE('ppt/commentAuthors.xml', 'officedocument.presentationml.commentAuthors+xml') +
          OVERRIDE('ppt/diagrams/data1.xml', 'officedocument.drawingml.diagramData+xml'),
      ),
    ),
    '_rels/.rels': strToU8(PKG_RELS('ppt/presentation.xml')),
    'docProps/core.xml': strToU8(CORE),
    'docProps/app.xml': strToU8(APP(['Max Mustermann'])),
    'docProps/custom.xml': strToU8(CUSTOM),
    'docProps/thumbnail.jpeg': jpegWithExif('Max Mustermann'),
    'ppt/presentation.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}/>`),
    'ppt/_rels/presentation.xml.rels': strToU8(RELS(REL('rId1', 'slide', 'slides/slide1.xml') + REL('rId2', 'slideMaster', 'slideMasters/slideMaster1.xml') + REL('rId3', 'commentAuthors', 'commentAuthors.xml'))),
    'ppt/slides/slide1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}>${tree(sp('Max Mustermann', 'Anna Alttext'))}</p:sld>`),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(
      RELS(REL('rId1', 'comments', '../comments/comment1.xml') + REL('rId2', 'hyperlink', 'mailto:Lars%20Link', true) + REL('rId3', 'diagramData', '../diagrams/data1.xml')),
    ),
    'ppt/diagrams/data1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="{1}"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Sven SmartArt</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst></dgm:dataModel>`,
    ),
    'ppt/slideMasters/slideMaster1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}>${tree(sp('© Mona Master'))}</p:sldMaster>`),
    'ppt/comments/comment1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:cmLst ${NS}><p:cm authorId="0" dt="2026-01-01T00:00:00.000" idx="1"><p:pos x="10" y="10"/><p:text>Frage an Hans Geheimnis</p:text></p:cm></p:cmLst>`),
    'ppt/commentAuthors.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:cmAuthorLst ${NS}><p:cmAuthor id="0" name="Erika Musterfrau" initials="EM" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>`),
  });
}

function odtFixture(): Uint8Array {
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"';
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.3"><office:body><office:text>
<text:tracked-changes><text:changed-region text:id="ct1"><text:deletion><office:change-info><dc:creator>Erika Musterfrau</dc:creator><dc:date>2026-01-01T00:00:00</dc:date></office:change-info><text:p>Kunde Hans Geheimnis</text:p></text:deletion></text:changed-region></text:tracked-changes>
<text:p>Vertrag mit Max Mustermann <text:a xlink:type="simple" xlink:href="https://intranet.example.com/Lars%20Link">Profil</text:a><office:annotation><dc:creator>Erika Musterfrau</dc:creator><dc:date>2026-01-01T00:00:00</dc:date><text:p>Notiz zu Geheim GmbH</text:p></office:annotation></text:p>
<text:p><draw:frame draw:name="Bild1"><draw:image xlink:href="Pictures/a.jpg"/><svg:title>Anna Alttext</svg:title></draw:frame></text:p>
</office:text></office:body></office:document-content>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS} office:version="1.3"><office:meta><dc:title>Tina Titel</dc:title><meta:initial-creator>Erika Musterfrau</meta:initial-creator><dc:creator>Erika Musterfrau</dc:creator><meta:template xlink:href="file:///C:/Users/max/Geheim%20GmbH/v.ott"/><meta:user-defined meta:name="Kunde">Erika Musterfrau</meta:user-defined></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest ${NS} manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Pictures/a.jpg" manifest:media-type="image/jpeg"/><manifest:file-entry manifest:full-path="Thumbnails/thumbnail.png" manifest:media-type="image/png"/></manifest:manifest>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?><office:document-settings ${NS}><office:settings><config:config-item-set config:name="ooo:configuration-settings"><config:config-item config:name="PrinterName" config:type="string">\\\\geheim-gmbh\\Drucker Max Mustermann</config:config-item></config:config-item-set></office:settings></office:document-settings>`;
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': strToU8(content),
    'meta.xml': strToU8(meta),
    'settings.xml': strToU8(settings),
    'Pictures/a.jpg': jpegWithExif('Bernd Bild'),
    'Thumbnails/thumbnail.png': strToU8('PNG Max Mustermann'),
    'META-INF/manifest.xml': strToU8(manifest),
  });
}

/** All entries (recursively in embedded ZIPs) as latin1 and UTF-8 text */
function allText(bytes: Uint8Array, prefix = ''): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    out.push([prefix + name, strFromU8(data, true) + '\n' + strFromU8(data)]);
    if (data[0] === 0x50 && data[1] === 0x4b) out.push(...allText(data, `${prefix}${name}!`));
  }
  return out;
}

function leaks(bytes: Uint8Array): string[] {
  const found: string[] = [];
  for (const [name, text] of allText(bytes)) {
    const low = text.toLowerCase();
    for (const t of [...TERMS.map(([o]) => o), ...TRACES]) if (low.includes(t.toLowerCase())) found.push(`${t} in ${name}`);
  }
  return found;
}

/** Consistency: every override, every internal relationship target and every manifest entry exists */
function inconsistencies(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes);
  const names = new Set(Object.keys(files).map((n) => n.toLowerCase()));
  const bad: string[] = [];
  const ct = files['[Content_Types].xml'];
  if (ct) for (const m of strFromU8(ct).matchAll(/PartName="\/([^"]+)"/g)) if (!names.has(m[1].toLowerCase())) bad.push(`override ${m[1]}`);
  for (const [n, d] of Object.entries(files)) {
    if (!n.endsWith('.rels')) continue;
    const base = n.replace(/_rels\/[^/]*\.rels$/, '');
    for (const m of strFromU8(d).matchAll(/<Relationship\b[^>]*>/g)) {
      if (/TargetMode="External"/.test(m[0])) continue;
      const t = decodeURIComponent(/Target="([^"]*)"/.exec(m[0])![1]);
      const parts = (t.startsWith('/') ? t.slice(1) : base + t).split('/');
      const res: string[] = [];
      for (const p of parts) p === '..' ? res.pop() : p !== '.' && res.push(p);
      if (!names.has(res.join('/').toLowerCase())) bad.push(`rel ${n} → ${t}`);
    }
  }
  const mf = files['META-INF/manifest.xml'];
  if (mf) {
    for (const m of strFromU8(mf).matchAll(/manifest:full-path="([^"]+)"/g)) {
      if (m[1] !== '/' && !m[1].endsWith('/') && !names.has(m[1].toLowerCase())) bad.push(`manifest ${m[1]}`);
    }
  }
  return bad;
}

const OUT = process.env.ALIAS_LEAK_OUT;

async function roundtrip(name: string, src: Uint8Array) {
  const shown = (await parseFile(name, src)).content;
  const enc = makeCopy(name, src, 'encode', ENC, shown);
  const dec = makeCopy(enc.name, enc.bytes, 'decode', DEC);
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'src_' + name), src);
    writeFileSync(join(OUT, enc.name), enc.bytes);
    writeFileSync(join(OUT, dec.name), dec.bytes);
  }
  return { shown, enc, dec };
}

// ---------------------------------------------------------------- Tests

describe('Leak-Tests (Kodieren bereinigt)', () => {
  for (const [name, make, kinds] of [
    ['Vertrag_Max_Mustermann.docx', docxFixture, 'docx'],
    ['Kunden_Max_Mustermann.xlsx', xlsxFixture, 'xlsx'],
    ['Max Mustermann Vortrag.pptx', pptxFixture, 'pptx'],
    ['Max_Mustermann.odt', odtFixture, 'odt'],
  ] as const) {
    it(`${kinds}: keine Originale in der kodierten Kopie, Teile konsistent`, async () => {
      const src = make();
      expect(leaks(src).length).toBeGreaterThan(0);
      const { shown, enc, dec } = await roundtrip(name, src);
      expect(leaks(enc.bytes)).toEqual([]);
      expect(enc.name).not.toMatch(/Max|Mustermann/);
      expect(inconsistencies(enc.bytes)).toEqual([]);
      expect(inconsistencies(dec.bytes)).toEqual([]);
      // Shown = replaced: every term in the file (except those only in removed parts) is visible
      const kept = makeCopy(name, src, 'encode', []).bytes; // only cleaned, nothing replaced
      const inFile = TERMS.map(([o]) => o).filter((o) => allText(kept).some(([, t]) => t.includes(o)));
      expect(inFile).not.toContain('Bernd Bild');
      for (const o of inFile) expect(shown, `"${o}" wird ersetzt, aber nicht angezeigt`).toContain(o);
      expect(enc.missed).toEqual([]);
      // Decoding restores the shown text
      expect((await parseFile(dec.name, dec.bytes)).content).toBe(shown);
    });
  }

  it('docx: Bericht über entfernte und ungeprüfte Teile', async () => {
    const { enc } = await roundtrip('a.docx', docxFixture());
    expect(enc.removed).toEqual(
      expect.arrayContaining([
        'Thumbnail image (preview of the first page)',
        'Custom document properties',
        'Co-author list (names and e-mail addresses)',
        'Attached template path',
        'Author names of comments and tracked changes',
      ]),
    );
    expect(enc.removed.join('\n')).toMatch(/EXIF/);
    expect(enc.warnings.join('\n')).toMatch(/oleObject1\.bin" not checked/);
    expect(enc.warnings.join('\n')).toMatch(/1 image not checked/);
    expect(enc.warnings.join('\n')).toMatch(/Tracked changes are kept/);
    const doc = strFromU8(unzipSync(enc.bytes)['word/document.xml']);
    expect(doc).toContain('w:author="Author"');
    expect(doc).toContain('mailto:Email-1');
    const settings = strFromU8(unzipSync(enc.bytes)['word/settings.xml']);
    expect(settings).not.toContain('attachedTemplate');
    expect(unzipSync(enc.bytes)['word/_rels/settings.xml.rels']).toBeDefined();
  });

  it('xlsx: Blatt konsistent umbenannt, Formeln gültig', async () => {
    const { enc } = await roundtrip('k.xlsx', xlsxFixture());
    const files = unzipSync(enc.bytes);
    const wb = strFromU8(files['xl/workbook.xml']);
    expect(wb).toContain('<sheet name="Kunde Person-3"');
    expect(wb).toContain("'Kunde Person-3'!$A$1:$E$1");
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain(`<f>"Person-11"&amp;"!"</f>`);
    expect(sheet).toContain(`<f>'Kunde Person-3'!A1&amp;""</f>`);
    expect(sheet).toContain('<f>SUM(Daten!B1:B2)</f>');
    expect(sheet).toContain(`location="'Kunde Person-3'!A1"`);
    expect(sheet).toContain('<oddHeader>&amp;LPerson-10&amp;RSeite &amp;P</oddHeader>');
    expect(strFromU8(files['xl/pivotCache/pivotCacheDefinition1.xml'])).toContain('sheet="Kunde Person-3"');
    // The link note <-> threaded comment (tc=) stays, otherwise Excel does not open the file
    expect(strFromU8(files['xl/comments1.xml'])).toContain('<authors><author>Author</author><author>tc={1B4D3F7A-0000-0000-0000-000000000002}</author></authors>');
    expect(strFromU8(files['xl/persons/person.xml'])).toContain('displayName="Author"');
    expect(enc.warnings.filter((w) => /still present|could not be replaced/.test(w))).toEqual([]);
  });

  it('xlsx: Blatt bleibt, wenn der Alias kein gültiger Blattname ist', () => {
    const src = xlsxBytes({ sheet: 'Max Mustermann', cell: 'x' });
    const e: AliasEntry[] = [{ id: '1', original: 'Max Mustermann', alias: 'Person[1]', category: 'person', confirmed: true }];
    const enc = makeCopy('a.xlsx', src, 'encode', pairs(e, 'encode'));
    expect(strFromU8(unzipSync(enc.bytes)['xl/workbook.xml'])).toContain('name="Max Mustermann"');
    expect(enc.warnings.join('\n')).toMatch(/Sheet name "Max Mustermann" could not be replaced/);
  });

  it('Dekodieren entfernt nichts', () => {
    const src = docxFixture();
    const dec = makeCopy('a.docx', src, 'decode', DEC);
    expect(Object.keys(unzipSync(dec.bytes))).toEqual(Object.keys(unzipSync(src)));
    expect(dec.removed).toEqual([]);
    expect(dec.warnings).toEqual([]);
  });

  it('sanitize abschaltbar', () => {
    const src = docxFixture();
    const enc = makeCopy('a.docx', src, 'encode', ENC, undefined, { sanitize: false });
    expect(Object.keys(unzipSync(enc.bytes))).toEqual(Object.keys(unzipSync(src)));
    expect(enc.removed).toEqual([]);
  });
});

describe('Bausteine', () => {
  it('Dateiname: Begriffe im Stamm, _ als Trenner', () => {
    expect(outputName('Vertrag_Max_Mustermann.docx', 'encode', ENC)).toBe('Vertrag_Person-1_anonym.docx');
    expect(outputName('Vertrag_Person-1_anonym.docx', 'decode', DEC)).toBe('Vertrag_Max_Mustermann_original.docx');
    expect(outputName('Max Mustermann Vortrag.pptx', 'encode', ENC)).toBe('Person-1 Vortrag_anonym.pptx');
    expect(outputName('Maximilian.docx', 'encode', [['Max', 'P']])).toBe('Maximilian_anonym.docx');
    expect(outputName('a_Max.docx', 'encode', [['Max', 'x/y:z']])).toBe('a_xyz_anonym.docx');
    expect(outputName('bericht.docx', 'encode', ENC)).toBe('bericht_anonym.docx');
  });

  it('Formeln: Literale und Blattverweise', () => {
    const sheet = (s: string) => (s === 'Kunde X' ? 'P 1' : s === 'Max' ? 'P-2' : null);
    const lit = (s: string) => (s.includes('Max') ? s.replace('Max', 'P-2') : null);
    expect(rewriteFormula(`'Kunde X'!A1&"Max ""M"""&Max!B2`, { sheet, literal: lit })).toBe(`'P 1'!A1&"P-2 ""M"""&'P-2'!B2`);
    expect(rewriteFormula('SUM(Max:Daten!A1)+[1]Max!A1+#REF!', { sheet })).toBe("SUM('P-2:Daten'!A1)+[1]Max!A1+#REF!");
    expect(rewriteFormula('Tabelle1[[#This Row],[Max]]', { sheet })).toBe('Tabelle1[[#This Row],[Max]]');
  });

  it('JPEG: EXIF entfernt, Ausrichtung bleibt', () => {
    const src = jpegWithExif('Bernd Bild');
    const out = stripJpegMetadata(src)!;
    expect(strFromU8(out, true)).not.toContain('Bernd');
    expect(strFromU8(out, true)).toContain('Exif');
    expect(out.slice(-7)).toEqual(src.slice(-7));
    expect(stripJpegMetadata(out)).not.toBeNull(); // the minimal Exif block can be removed again
    expect(stripJpegMetadata(strToU8('kein jpeg'))).toBeNull();
  });
});
