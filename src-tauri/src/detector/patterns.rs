use once_cell::sync::Lazy;
use regex::Regex;

/// Firmennamen mit deutschen Rechtssuffixen.
/// Jedes Wort im Namen MUSS mit einem Großbuchstaben, Ziffer oder & beginnen –
/// verhindert, dass Satzfragmente wie „Der Vertrag mit der …" miterfasst werden.
pub static COMPANY_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?u)\b([A-ZÜÄÖ][A-Za-züäöÜÄÖß\-\.]*(?:\s+(?:(?:&|und|von|de)\s+)?[A-ZÜÄÖ0-9][A-Za-züäöÜÄÖß\-\.&]*){0,7})\s+(GmbH(?:\s*&\s*Co\.?\s*KG)?|AG|SE|KG|OHG|UG(?:\s*\(haftungsbeschränkt\))?|eG|mbH|GbR|e\.V\.|e\.K\.|Ltd\.|Inc\.|Corp\.)\b"
    ).unwrap()
});

/// Zwei bis drei Namenswörter (Vorname + Nachname, optional zweiter Vorname) — Schicht C.
/// Nicht mehr `{1,3}` beliebig, damit keine Kalender-/UI-Wörter wie „Onboarding Day“ anhängen.
pub static PERSON_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?u)\b([A-ZÜÄÖ][a-züäöß]{1,30})(?:\s+(?:van|von|de|der|den|zum|zur)\s+)?(?:\s+[A-ZÜÄÖ][a-züäöß]{1,30}){1,2}\b"
    ).unwrap()
});

/// Häufige Großschreibung nach Namen (Kalender, Rollen, UI) — von Schicht C vom Ende wegschneiden.
pub static PERSON_SUFFIX_STOPWORDS: Lazy<std::collections::HashSet<String>> = Lazy::new(|| {
    [
        "Onboarding",
        "Day",
        "Week",
        "Direct",
        "Indirect",
        "Meeting",
        "Call",
        "Session",
        "Review",
        "Sprint",
        "Training",
        "Workshop",
        "Project",
        "Team",
        "Lead",
        "Manager",
        "Director",
        "Directors",
        "Direktor",
        "Direktorin",
        "Standup",
        "Kickoff",
        "Planning",
        "Board",
        "Interview",
        "Office",
        "Home",
        "Remote",
        "Onsite",
        "Sync",
        "Townhall",
        "Allhands",
        "Conference",
        "Summit",
        "Forum",
        "Webinar",
        "Seminar",
        "Course",
        "Class",
        "Shift",
        "Rotation",
        "Buddy",
        "Mentor",
        "Coach",
        "Owner",
        "Stakeholder",
        "Update",
        "Newsletter",
        "Digest",
        "Report",
        "Deck",
        "Slides",
        "Notes",
        "Agenda",
        "Minutes",
        "Followup",
        "Follow-up",
        "Checkin",
        "Checkout",
        "Signup",
        "Launch",
        "Release",
        "Beta",
        "Alpha",
        "Pilot",
        "Phase",
        "Stage",
        "Gate",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
});

/// Typische Nomen/Rollen nach einem Vornamen, die selten Nachnamen sind — Schicht C vom Ende kürzen (auch auf einen Vornamen).
pub static PERSON_NON_NAME_TAIL_WORDS: Lazy<std::collections::HashSet<String>> = Lazy::new(|| {
    [
        "Unterstützung",
        "Director",
        "Directors",
        "Direktor",
        "Direktorin",
        "Direktion",
        "Support",
        "Marketing",
        "Sales",
        "Service",
        "Services",
        "Assistance",
        "Begleitung",
        "Beratung",
        "Koordination",
        "Organisation",
        "Kommunikation",
        "Entwicklung",
        "Vertrieb",
        "Einkauf",
        "Personal",
        "Admin",
        "Administrator",
        "Administratorin",
        "Consulting",
        "Partner",
        "Partnerschaft",
        "Management",
        "Operations",
        "Engineering",
        "Product",
        "Products",
        "Solutions",
        "Helpdesk",
        "Help",
        "Desk",
        "Hotline",
        "Backoffice",
        "Frontend",
        "Backend",
        "Office",
        "Team",
        "Group",
        "Unit",
        "Department",
        "Abteilung",
        "Bereich",
        "Gruppe",
        "Projekt",
        "Programm",
        "Initiative",
        "Workstream",
        "Stream",
        "Owner",
        "Lead",
        "Head",
        "Chief",
        "Officer",
        "Representative",
        "Specialist",
        "Coordinator",
        "Assistant",
        "Assistent",
        "Assistentin",
        "Sachbearbeitung",
        "Disposition",
        "Logistik",
        "Qualität",
        "Qualitätssicherung",
        "Controlling",
        "Finance",
        "Accounting",
        "Buchhaltung",
        "Recht",
        "Legal",
        "Compliance",
        "Security",
        "IT",
        "HR",
        "PR",
        "UX",
        "UI",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
});

/// PRD Schicht A: Titel/Anrede + Name (Gruppe 1 = Name)
pub static PERSON_TITLE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?u)\b(?:Dr\. med\.|Prof\. Dr\.|Dipl\.-Ing\.|Ing\.|Mag\.|Dr\.|Prof\.|Herr|Frau|Herrn|Hr\.|Fr\.|Mr\.|Mrs\.|Ms\.)\s+((?:[A-ZÄÖÜ][a-zäöüß]+)(?:\s+(?:van|von|de|der|den|zum|zur)\s+)?(?:\s+[A-ZÄÖÜ][a-zäöüß]+){0,3})\b"
    ).unwrap()
});

/// PRD Schicht B: Satzkontext + 1–3 Namenswörter (Gruppe 1)
pub static PERSON_CONTEXT_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?u)\b(?:mein\s+Name\s+ist|ich\s+heiße|Ansprechpartner:\s*|Sachbearbeiter:\s*|Verfasser:\s*|gez\.)\s*([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+){0,2})\b",
    )
    .unwrap()
});

pub static PERSON_GREETING_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?u)\bHallo\s+([A-ZÄÖÜ][a-zäöüß]+)\b").unwrap()
});

/// PRD Schicht B: „Liebe/Lieber …“
pub static PERSON_LIEBE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?u)\bLiebe[rn]?\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)\b").unwrap()
});

/// Signalwort + firmenähnlicher Name (Gruppe 1 = Name)
pub static COMPANY_SIGNAL_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?u)\b(?:Firma|Hersteller|Partner|Lieferant|Kunde|Unternehmen)\s+([A-ZÜÄÖ][A-Za-züäöÜÄÖß0-9\-\.&]{1,50}(?:\s+[A-ZÜÄÖ][A-Za-züäöß]{1,40}){0,2})\b"
    ).unwrap()
});

/// Abkürzungen 2–5 Unicode-Großbuchstaben (z. B. TÜV)
pub static ABBREV_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?u)\b([\p{Lu}]{2,5})\b").unwrap()
});

/// Akronym mit Bindestrich und Namensrest, optional mit Punkt (z. B. TÜV-Rheinl.)
/// Kein abschließendes `\b`: sonst endet das Match vor dem Punkt (Wortgrenze l|.).
/// Statt Lookahead: obligatorisches Wortende (Leerzeichen, Satzzeichen, EOS) nach dem Match.
pub static HYPHENATED_FIRMA_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?u)\b([\p{Lu}]{2,5}-[A-Za-züäöÜÄÖß]+\.?)(?:\s|$|[,;:\)])").unwrap()
});

/// Akronym (2–5 Großbuchstaben) + Leerzeichen + firmenähnliches Wort (z. B. „KMD Consulting“)
pub static ACRONYM_SPACE_FIRMA_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?u)\b([\p{Lu}]{2,5}\s+[A-ZÜÄÖ][a-züäöß]{2,40})\b").unwrap()
});

/// Anführungszeichen-Strings (deutsch und englisch)
pub static QUOTED_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?u)[„""»«]([^„"""»«\n]{2,50})["""»«„]"#).unwrap()
});

/// Markenzeichen ® und ™ — nur direkt vorangehende Wortzeichen, keine Leerzeichen.
pub static TRADEMARK_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?u)\b([\w\-]{2,30})[®™]").unwrap()
});

/// Bekannte Stoppwörter die keine Personennamen sind
pub static PERSON_STOPWORDS: Lazy<std::collections::HashSet<String>> = Lazy::new(|| {
    [
        // Deutsche Nomen die oft großgeschrieben werden, keine Namen
        "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
        "September", "Oktober", "November", "Dezember",
        "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag",
        "Deutschland", "Europa", "Amerika", "Asien", "Afrika",
        "Seite", "Kapitel", "Abschnitt", "Anhang", "Tabelle", "Abbildung",
        "Der", "Die", "Das", "Ein", "Eine", "Einen",
        "Sehr", "Viele", "Alle", "Keine", "Seine", "Ihre",
        // Abkürzungs-Stopwords (werden vom ABBREV-Pass behandelt)
        "IT", "PC", "OK", "PDF", "API", "XML", "URL", "ID", "ERP", "CRM",
        "HR", "PR", "QA", "UI", "UX", "DB", "IO", "OS", "AI", "ML",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
});

/// ALL-CAPS die definitiv keine Entitäten sind
pub static ABBREV_STOPWORDS: Lazy<std::collections::HashSet<String>> = Lazy::new(|| {
    [
        "IT", "PC", "OK", "PDF", "API", "XML", "URL", "ID", "ERP", "CRM",
        "HR", "PR", "QA", "UI", "UX", "DB", "IO", "OS", "AI", "ML",
        "DE", "EN", "FR", "US", "EU", "UN", "NATO", "WHO",
        "USD", "EUR", "GBP", "CHF",
        "AM", "PM", "CA", "VS", "PS", "NB",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
});
