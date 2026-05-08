import { invoke } from '@tauri-apps/api/core';
import type {
  AliasEntry,
  BulkAddItem,
  Category,
  EntityCandidate,
  ParsedDocument,
  SubstitutionResult,
} from './types';

export async function openFileDialog(): Promise<ParsedDocument | null> {
  return invoke<ParsedDocument | null>('open_file_dialog');
}

export async function openFile(path: string): Promise<ParsedDocument> {
  return invoke<ParsedDocument>('open_file', { path });
}

export async function detectEntities(text: string): Promise<EntityCandidate[]> {
  return invoke<EntityCandidate[]>('detect_entities', { text });
}

export interface NerStatus {
  models_dir: string | null;
  model_onnx: boolean;
  tokenizer_json: boolean;
  ner_labels_json: boolean;
  engine_loaded: boolean;
  test_results: string[];
  ready: boolean;
}

export async function nerStatus(): Promise<NerStatus> {
  return invoke<NerStatus>('ner_status');
}

export async function getStore(): Promise<AliasEntry[]> {
  return invoke<AliasEntry[]>('get_store');
}

export async function addEntry(
  original: string,
  alias: string | null,
  category: Category
): Promise<AliasEntry> {
  return invoke<AliasEntry>('add_entry', { original, alias, category });
}

export async function addEntriesBulk(items: BulkAddItem[]): Promise<AliasEntry[]> {
  return invoke<AliasEntry[]>('add_entries_bulk', { items });
}

export async function updateEntry(
  id: string,
  alias?: string,
  category?: Category,
  confirmed?: boolean
): Promise<AliasEntry> {
  return invoke<AliasEntry>('update_entry', { id, alias, category, confirmed });
}

export async function removeEntry(id: string): Promise<void> {
  return invoke<void>('remove_entry', { id });
}

export async function clearStore(): Promise<void> {
  return invoke<void>('clear_store');
}

export async function getAutoAlias(text: string, category: Category): Promise<string> {
  return invoke<string>('get_auto_alias', { text, category });
}

export async function encodeText(text: string): Promise<SubstitutionResult> {
  return invoke<SubstitutionResult>('encode_text', { text });
}

export async function decodeText(text: string): Promise<SubstitutionResult> {
  return invoke<SubstitutionResult>('decode_text', { text });
}

export async function previewSubstitutions(
  text: string,
  mode: 'encode' | 'decode'
): Promise<[number, number][]> {
  return invoke<[number, number][]>('preview_substitutions', { text, mode });
}

export async function saveStore(path?: string): Promise<string> {
  return invoke<string>('save_store', { path });
}

export async function exportStoreDialog(): Promise<string | null> {
  return invoke<string | null>('export_store_dialog');
}

export async function importStoreDialog(): Promise<AliasEntry[] | null> {
  return invoke<AliasEntry[] | null>('import_store_dialog');
}

export async function saveFileCopy(
  sourcePath: string,
  mode: 'encode' | 'decode'
): Promise<string> {
  return invoke<string>('save_file_copy', { sourcePath, mode });
}

export async function saveTextAsDialog(
  content: string,
  defaultFileName?: string
): Promise<string | null> {
  return invoke<string | null>('save_text_as_dialog', {
    content,
    defaultFileName: defaultFileName ?? null,
  });
}
