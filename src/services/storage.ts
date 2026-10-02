// Persistencia local (IndexedDB vía idb-keyval, con respaldo en memoria).

import { del, get, set } from 'idb-keyval';

const memory = new Map<string, unknown>();

export async function load<T>(key: string): Promise<T | undefined> {
  try {
    return (await get<T>(key)) ?? (memory.get(key) as T | undefined);
  } catch {
    return memory.get(key) as T | undefined;
  }
}

export async function save<T>(key: string, value: T): Promise<void> {
  memory.set(key, value);
  try {
    await set(key, value);
  } catch {
    // IndexedDB no disponible: queda en memoria
  }
}

export async function remove(key: string): Promise<void> {
  memory.delete(key);
  try {
    await del(key);
  } catch {
    // ignorar
  }
}
