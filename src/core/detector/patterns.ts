/** Port of patterns.rs and gazetteer.rs */
import firstNamesRaw from '../data/first_names.txt?raw';
import nameExclusionsRaw from '../data/name_exclusions.txt?raw';
import { dataLines, rx, trimPunct } from '../util';

/**
 * Space inside a name: only horizontal spaces (Unicode Zs: space, NBSP,
 * U+1680, U+2000–200A, U+202F, U+205F, U+3000), no tab/line break/\v/\f/U+2028/2029/U+0085.
 * The Rust original used `\s`; in tables (Excel/CSV/Word tables) the company pattern then
 * merged several cells and rows into one "company" and blocked all other matches.
 * U+3000 (ideographic space) stays allowed: a real word gap as in Rust, not a
 * cell or line separator.
 */
const SP = String.raw`\p{Zs}`;

/**
 * Space between salutation/title or signal word and name: like Rust `\s`, but without tab.
 * A line break after the salutation is common in the address block (DIN 5008: "Frau\nKsenia Nowak");
 * a tab, however, separates table cells ("Herr⇥Müller" practically only occurs in two columns).
 */
const GAP = String.raw`[^\S\t]`;

/**
 * Particle between name words. Rust: `(?:\s+(?:van|…)\s+)?(?:\s+Wort)`; two directly
 * consecutive `\s+` backtrack quadratically in JS ("Anna von" + many spaces;
 * Rust regex is linear). Equivalent: exactly one space after the particle, followed by
 * at least one more (the following `SP+` takes the rest); identical match spans.
 */
const PARTICLE = String.raw`(?:${SP}+(?:van|von|de|der|den|zum|zur)${SP}(?=${SP}))?`;

/** Company names with German legal suffixes. */
export const COMPANY_REGEX = rx(
  String.raw`(?u)\b([A-ZÜÄÖ][A-Za-züäöÜÄÖß\-\.]*(?:${SP}+(?:(?:&|und|von|de)${SP}+)?[A-ZÜÄÖ0-9][A-Za-züäöÜÄÖß\-\.&]*){0,7})${SP}+(GmbH(?:${SP}*&${SP}*Co\.?${SP}*KG)?|AG|SE|KG|OHG|UG(?:${SP}*\(haftungsbeschränkt\))?|eG|mbH|GbR|e\.V\.|e\.K\.|Ltd\.|Inc\.|Corp\.|LLC)\b`,
);

/** Two to three name words: layer C (not across tab/line break). */
export const PERSON_REGEX = rx(
  String.raw`(?u)\b([A-ZÜÄÖ][a-züäöß]{1,30})${PARTICLE}(?:${SP}+[A-ZÜÄÖ][a-züäöß]{1,30}){1,2}\b`,
);

export const PERSON_SUFFIX_STOPWORDS = new Set([
  'Onboarding', 'Day', 'Week', 'Direct', 'Indirect', 'Meeting', 'Call', 'Session', 'Review',
  'Sprint', 'Training', 'Workshop', 'Project', 'Team', 'Lead', 'Manager', 'Director', 'Directors',
  'Direktor', 'Direktorin', 'Standup', 'Kickoff', 'Planning', 'Board', 'Interview', 'Office',
  'Home', 'Remote', 'Onsite', 'Sync', 'Townhall', 'Allhands', 'Conference', 'Summit', 'Forum',
  'Webinar', 'Seminar', 'Course', 'Class', 'Shift', 'Rotation', 'Buddy', 'Mentor', 'Coach',
  'Owner', 'Stakeholder', 'Update', 'Newsletter', 'Digest', 'Report', 'Deck', 'Slides', 'Notes',
  'Agenda', 'Minutes', 'Followup', 'Follow-up', 'Checkin', 'Checkout', 'Signup', 'Launch',
  'Release', 'Beta', 'Alpha', 'Pilot', 'Phase', 'Stage', 'Gate',
]);

export const PERSON_NON_NAME_TAIL_WORDS = new Set([
  'Unterstützung', 'Director', 'Directors', 'Direktor', 'Direktorin', 'Direktion', 'Support',
  'Marketing', 'Sales', 'Service', 'Services', 'Assistance', 'Begleitung', 'Beratung',
  'Koordination', 'Organisation', 'Kommunikation', 'Entwicklung', 'Vertrieb', 'Einkauf',
  'Personal', 'Admin', 'Administrator', 'Administratorin', 'Consulting', 'Partner',
  'Partnerschaft', 'Management', 'Operations', 'Engineering', 'Product', 'Products', 'Solutions',
  'Helpdesk', 'Help', 'Desk', 'Hotline', 'Backoffice', 'Frontend', 'Backend', 'Office', 'Team',
  'Group', 'Unit', 'Department', 'Abteilung', 'Bereich', 'Gruppe', 'Projekt', 'Programm',
  'Initiative', 'Workstream', 'Stream', 'Owner', 'Lead', 'Head', 'Chief', 'Officer',
  'Representative', 'Specialist', 'Coordinator', 'Assistant', 'Assistent', 'Assistentin',
  'Sachbearbeitung', 'Disposition', 'Logistik', 'Qualität', 'Qualitätssicherung', 'Controlling',
  'Finance', 'Accounting', 'Buchhaltung', 'Recht', 'Legal', 'Compliance', 'Security', 'IT', 'HR',
  'PR', 'UX', 'UI',
]);

/**
 * Layer A: title/salutation + name (group 1 = name). Differs from the Rust original: several titles
 * in a row ("Herrn Dr. Jan Kowalski", "Frau Prof. Dr. Weber") are read as a chain;
 * Rust took "Dr" as the name (rejected later) and lost the actual name in this layer.
 */
export const PERSON_TITLE_REGEX = rx(
  String.raw`(?u)\b(?:(?:Dr\. med\.|Prof\. Dr\.|Dipl\.-Ing\.|Ing\.|Mag\.|Dr\.|Prof\.|Herrn|Herr|Frau|Hr\.|Fr\.|Mr\.|Mrs\.|Ms\.)${GAP}+)+((?:[A-ZÄÖÜ][a-zäöüß]+)${PARTICLE}(?:${SP}+[A-ZÄÖÜ][a-zäöüß]+){0,3})\b`,
);

/**
 * Layer B: sentence context + 1–3 name words (group 1). Rust: `Ansprechpartner:\s*` followed by
 * `\s*`; the double `\s*` backtracks quadratically in JS; one `\s*` is equivalent.
 */
export const PERSON_CONTEXT_REGEX = rx(
  String.raw`(?u)\b(?:mein\s+Name\s+ist|ich\s+heiße|Ansprechpartner:|Sachbearbeiter:|Verfasser:|gez\.)\s*([A-ZÄÖÜ][a-zäöüß]+(?:${SP}+[A-ZÄÖÜ][a-zäöüß]+){0,2})\b`,
);

/**
 * Greetings keep `SP`: after "Hallo"/"Liebe" + line break there is usually the start of a sentence
 * ("Hallo\nIch wollte …"), not a name.
 */
export const PERSON_GREETING_REGEX = rx(String.raw`(?u)\bHallo${SP}+([A-ZÄÖÜ][a-zäöüß]+)\b`);

export const PERSON_LIEBE_REGEX = rx(
  String.raw`(?u)\bLiebe[rn]?${SP}+([A-ZÄÖÜ][a-zäöüß]+(?:${SP}+[A-ZÄÖÜ][a-zäöüß]+)?)\b`,
);

/** Signal word + company-like name (group 1); line break allowed (address "Firma\nAcme") */
export const COMPANY_SIGNAL_REGEX = rx(
  String.raw`(?u)\b(?:Firma|Hersteller|Partner|Lieferant|Kunde|Unternehmen)${GAP}+([A-ZÜÄÖ][A-Za-züäöÜÄÖß0-9\-\.&]{1,50}(?:${SP}+[A-ZÜÄÖ][A-Za-züäöß]{1,40}){0,2})\b`,
);

/** Abbreviations of 2–5 Unicode capital letters (e.g. TÜV) */
export const ABBREV_REGEX = rx(String.raw`(?u)\b([\p{Lu}]{2,5})\b`);

/** Acronym with hyphen and rest of the name (e.g. TÜV-Rheinl.) */
export const HYPHENATED_FIRMA_REGEX = rx(
  String.raw`(?u)\b([\p{Lu}]{2,5}-[A-Za-züäöÜÄÖß]+\.?)(?:\s|$|[,;:\)])`,
);

/** Acronym + company-like word (e.g. "KMD Consulting") */
export const ACRONYM_SPACE_FIRMA_REGEX = rx(
  String.raw`(?u)\b([\p{Lu}]{2,5}${SP}+[A-ZÜÄÖ][a-züäöß]{2,40})\b`,
);

/** Strings in quotation marks (German and English) */
export const QUOTED_REGEX = rx(String.raw`(?u)[„"»«]([^„"»«\n]{2,50})["»«„]`);

/** Trademark signs ® and ™ */
export const TRADEMARK_REGEX = rx(String.raw`(?u)\b([\w\-]{2,30})[®™]`);

export const PERSON_STOPWORDS = new Set([
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober',
  'November', 'Dezember', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag',
  'Sonntag', 'Deutschland', 'Europa', 'Amerika', 'Asien', 'Afrika', 'Seite', 'Kapitel',
  'Abschnitt', 'Anhang', 'Tabelle', 'Abbildung', 'Der', 'Die', 'Das', 'Ein', 'Eine', 'Einen',
  'Sehr', 'Viele', 'Alle', 'Keine', 'Seine', 'Ihre', 'IT', 'PC', 'OK', 'PDF', 'API', 'XML', 'URL',
  'ID', 'ERP', 'CRM', 'HR', 'PR', 'QA', 'UI', 'UX', 'DB', 'IO', 'OS', 'AI', 'ML',
]);

/**
 * Capital-letter abbreviations that are not entities worth protecting (Rust list + additions:
 * field labels from letterheads/invoices, roles, legal/standards terms, technical formats).
 * Only forms that `ABBREV_REGEX` (2–5 capital letters) can match; legal forms like AG/KG/SE
 * are left out (company remnants). Also applies to the first part of "KMD Consulting".
 */
export const ABBREV_STOPWORDS = new Set([
  'IT', 'PC', 'OK', 'PDF', 'API', 'XML', 'URL', 'ID', 'ERP', 'CRM', 'HR', 'PR', 'QA', 'UI', 'UX',
  'DB', 'IO', 'OS', 'AI', 'ML', 'DE', 'EN', 'FR', 'US', 'EU', 'UN', 'NATO', 'WHO', 'USD', 'EUR',
  'GBP', 'CHF', 'AM', 'PM', 'CA', 'VS', 'PS', 'NB',
  // Field labels (bank, tax, register, contact)
  'IBAN', 'BIC', 'SWIFT', 'BLZ', 'UST', 'MWST', 'VAT', 'TAX', 'PLZ', 'TEL', 'FAX', 'NR', 'HRB',
  'HRA', 'LLC', 'INC', 'LTD',
  // Roles
  'CEO', 'CFO', 'CTO', 'COO', 'CIO', 'CISO',
  // Law/standards
  'AGB', 'DSGVO', 'GDPR', 'BGB', 'HGB', 'DIN', 'ISO', 'IEC', 'CE',
  // Correspondence
  'AW', 'WG', 'FW', 'FWD', 'RE', 'CC', 'BCC', 'ASAP', 'FYI', 'FAQ', 'MFG', 'VG', 'LG',
  // Technology/formats
  'HTML', 'CSS', 'JSON', 'CSV', 'SQL', 'HTTP', 'HTTPS', 'DNS', 'VPN', 'USB', 'IP', 'LAN', 'WLAN',
  'SMS', 'PIN', 'TAN', 'EDV',
  // Time/vehicles
  'KW', 'UTC', 'GMT', 'MEZ', 'MESZ', 'CET', 'CEST', 'LKW', 'PKW', 'KFZ',
]);

/**
 * Capitalized function words at the start of a sentence that `COMPANY_REGEX` pulls in front of the
 * company name ("Die Siemens AG", "Mit Acme GmbH"). They are cut off at the front as long as a name word
 * remains. Differs from the Rust original, which counted the article as part of the company name.
 */
export const COMPANY_LEADING_STOPWORDS = new Set([
  'Der', 'Die', 'Das', 'Den', 'Dem', 'Des', 'Ein', 'Eine', 'Einer', 'Einen', 'Einem', 'Eines',
  'Mit', 'Von', 'Bei', 'Für', 'Und', 'Oder', 'An', 'Am', 'Auf', 'Aus', 'In', 'Im', 'Zum', 'Zur',
  'Über', 'Unter', 'Durch', 'Nach', 'Vor', 'Seit', 'Gegen', 'Ohne', 'Laut', 'Gemäß', 'Wie', 'Als',
  'Auch', 'Sowie', 'Unser', 'Unsere', 'Unserer', 'Unseren', 'Ihr', 'Ihre', 'Ihrer', 'Ihren',
  'Diese', 'Dieser', 'Diesen', 'Jede', 'Jeder', 'Sehr', 'Liebe', 'Lieber', 'Hallo',
  'Firma', 'Hersteller', 'Lieferant', 'Kunde', 'Unternehmen',
]);

// ---------------------------------------------------------------- Gazetteer

const FIRST_NAMES = new Set(dataLines(firstNamesRaw));
const NAME_EXCLUSIONS = new Set(dataLines(nameExclusionsRaw));

/** `word` (or a hyphen segment as in Hans-Peter) is a known first name. */
export function looksLikeKnownFirstName(word: string): boolean {
  const w = trimPunct(word);
  if (FIRST_NAMES.has(w)) return true;
  return w
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => FIRST_NAMES.has(p));
}

/** First names that are often not a person's name (only with the title/context layer). */
export function isExclusionFirstName(word: string): boolean {
  return NAME_EXCLUSIONS.has(trimPunct(word));
}
