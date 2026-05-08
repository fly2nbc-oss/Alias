use std::collections::HashMap;
use uuid::Uuid;

use crate::error::AliasError;
use crate::types::{AliasEntry, BulkAddItem, Category};

pub struct AliasStore {
    /// Einträge, geordnet nach ID
    pub entries: HashMap<String, AliasEntry>,
    /// Lowercase-Original → ID (für schnelle Duplikatsprüfung)
    pub originals_index: HashMap<String, String>,
    /// Zähler pro Kategorie für Auto-Nummerierung
    pub counters: HashMap<String, usize>,
}

impl AliasStore {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            originals_index: HashMap::new(),
            counters: HashMap::new(),
        }
    }

    /// Generiert den nächsten Alias für eine Kategorie (z.B. "Person-1")
    pub fn next_alias(&mut self, category: &Category) -> String {
        let key = category.label().to_string();
        let counter = self.counters.entry(key.clone()).or_insert(0);
        *counter += 1;
        // Sicherstellen, dass der Alias nicht bereits existiert
        loop {
            let candidate = format!("{}-{}", key, counter);
            let already_used = self.entries.values().any(|e| e.alias == candidate);
            if !already_used {
                return candidate;
            }
            *counter += 1;
        }
    }

    /// Gibt den nächsten Alias zurück ohne ihn zu vergeben (für UI-Preview)
    pub fn preview_alias(&self, category: &Category) -> String {
        let key = category.label().to_string();
        let current = self.counters.get(&key).copied().unwrap_or(0);
        let mut n = current + 1;
        loop {
            let candidate = format!("{}-{}", key, n);
            let already_used = self.entries.values().any(|e| e.alias == candidate);
            if !already_used {
                return candidate;
            }
            n += 1;
        }
    }

    pub fn add(
        &mut self,
        original: String,
        alias_input: Option<String>,
        category: Category,
    ) -> Result<AliasEntry, AliasError> {
        let key = original.to_lowercase();
        if let Some(existing_id) = self.originals_index.get(&key) {
            // Eintrag bereits vorhanden – zurückgeben
            let entry = self.entries.get(existing_id).unwrap().clone();
            return Ok(entry);
        }

        let alias = match alias_input {
            Some(a) if !a.trim().is_empty() => a.trim().to_string(),
            _ => self.next_alias(&category),
        };

        let id = Uuid::new_v4().to_string();
        let entry = AliasEntry {
            id: id.clone(),
            original: original.clone(),
            alias,
            category,
            confirmed: true,
        };
        self.originals_index.insert(key, id.clone());
        self.entries.insert(id, entry.clone());
        Ok(entry)
    }

    pub fn add_bulk(
        &mut self,
        items: Vec<BulkAddItem>,
    ) -> Result<Vec<AliasEntry>, AliasError> {
        let mut result = Vec::new();
        for item in items {
            let entry = self.add(item.original, item.alias, item.category)?;
            result.push(entry);
        }
        Ok(result)
    }

    pub fn update(
        &mut self,
        id: &str,
        alias: Option<String>,
        category: Option<Category>,
        confirmed: Option<bool>,
    ) -> Result<AliasEntry, AliasError> {
        let entry = self
            .entries
            .get_mut(id)
            .ok_or_else(|| AliasError::EntryNotFound(id.to_string()))?;

        if let Some(a) = alias {
            entry.alias = a;
        }
        if let Some(c) = category {
            entry.category = c;
        }
        if let Some(conf) = confirmed {
            entry.confirmed = conf;
        }
        Ok(entry.clone())
    }

    pub fn remove(&mut self, id: &str) -> Result<(), AliasError> {
        let entry = self
            .entries
            .remove(id)
            .ok_or_else(|| AliasError::EntryNotFound(id.to_string()))?;
        self.originals_index.remove(&entry.original.to_lowercase());
        Ok(())
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.originals_index.clear();
        self.counters.clear();
    }

    pub fn list(&self) -> Vec<AliasEntry> {
        let mut list: Vec<AliasEntry> = self.entries.values().cloned().collect();
        list.sort_by(|a, b| a.original.to_lowercase().cmp(&b.original.to_lowercase()));
        list
    }

    /// Lädt Einträge aus einem Import – bestehende werden übersprungen (kein Überschreiben)
    pub fn import_entries(&mut self, entries: Vec<AliasEntry>) {
        for entry in entries {
            let key = entry.original.to_lowercase();
            if self.originals_index.contains_key(&key) {
                continue;
            }
            self.originals_index
                .insert(key, entry.id.clone());
            // Zähler aktualisieren
            let label = entry.category.label().to_string();
            // Versuche N aus dem Alias-Format "Label-N" zu extrahieren
            if let Some(suffix) = entry.alias.strip_prefix(&format!("{}-", label)) {
                if let Ok(n) = suffix.parse::<usize>() {
                    let counter = self.counters.entry(label).or_insert(0);
                    if n > *counter {
                        *counter = n;
                    }
                }
            }
            self.entries.insert(entry.id.clone(), entry);
        }
    }
}
