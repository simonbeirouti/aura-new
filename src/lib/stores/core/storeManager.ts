import { writable, type Writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

// Store configuration interface
export interface StoreConfig {
  saveOnChange: boolean;
  saveStrategy: 'immediate' | 'debounce' | 'throttle';
  saveInterval?: number;
  syncStrategy?: 'immediate' | 'debounce' | 'throttle';
  syncInterval?: number;
  autoStart?: boolean;
  filterKeys?: string[];
  filterKeysStrategy?: 'omit' | 'include';
}

// Base store interface
export interface BaseStore<T> {
  subscribe: Writable<T>['subscribe'];
  set: (value: T) => void;
  update: (updater: (value: T) => T) => void;
  sync: () => Promise<void>;
  load: () => Promise<void>;
  save: () => Promise<void>;
  reset: () => void;
  destroy: () => void;
}

// Store manager for handling multiple stores
export class StoreManager {
  private stores: Map<string, BaseStore<any>> = new Map();
  private initialized = false;

  async initialize() {
    if (this.initialized) return;
    
    // Initialize core system stores first
    await this.initializeSystemStores();
    this.initialized = true;
  }

  private async initializeSystemStores() {
    // These stores are always active and load immediately
    const systemStores = ['session', 'config'];
    
    for (const storeId of systemStores) {
      const store = this.stores.get(storeId);
      if (store) {
        await store.load();
      }
    }
  }

  registerStore<T>(id: string, store: BaseStore<T>) {
    this.stores.set(id, store);
  }

  getStore<T>(id: string): BaseStore<T> | undefined {
    return this.stores.get(id);
  }

  async syncAll() {
    const promises = Array.from(this.stores.values()).map(store => store.sync());
    await Promise.all(promises);
  }

  async saveAll() {
    const promises = Array.from(this.stores.values()).map(store => store.save());
    await Promise.all(promises);
  }

  destroy() {
    this.stores.forEach(store => store.destroy());
    this.stores.clear();
    this.initialized = false;
  }
}

// Enhanced store implementation
export function createEnhancedStore<T>(
  id: string,
  initialData: T,
  config: StoreConfig
): BaseStore<T> {
  const { subscribe, set, update } = writable<T>(initialData);
  let currentData = initialData;
  let saveTimeout: NodeJS.Timeout | null = null;
  let syncTimeout: NodeJS.Timeout | null = null;
  let isLoaded = false;

  // Subscribe to changes for auto-save
  const unsubscribe = subscribe((value) => {
    currentData = value;
    if (config.saveOnChange && isLoaded) {
      scheduleSave();
    }
  });

  function scheduleSave() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    const delay = config.saveStrategy === 'immediate' ? 0 : (config.saveInterval || 1000);
    
    saveTimeout = setTimeout(async () => {
      await save();
    }, delay);
  }

  function scheduleSync() {
    if (!config.syncStrategy) return;
    
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }

    const delay = config.syncStrategy === 'immediate' ? 0 : (config.syncInterval || 1000);
    
    syncTimeout = setTimeout(async () => {
      await sync();
    }, delay);
  }

  async function load(): Promise<void> {
    try {
      const result = await invoke<T>('store_get', { storeId: id });
      if (result) {
        set(result);
        isLoaded = true;
      }
    } catch (error) {
      console.warn(`Failed to load store ${id}:`, error);
      // Continue with initial data
      isLoaded = true;
    }
  }

  async function save(): Promise<void> {
    try {
      let dataToSave = currentData;
      
      // Apply filters if configured
      if (config.filterKeys && config.filterKeysStrategy) {
        dataToSave = applyFilters(currentData, config.filterKeys, config.filterKeysStrategy);
      }

      await invoke('store_set', { 
        storeId: id, 
        data: dataToSave 
      });
    } catch (error) {
      console.error(`Failed to save store ${id}:`, error);
    }
  }

  async function sync(): Promise<void> {
    // Sync with backend if needed
    scheduleSync();
  }

  function applyFilters<T>(data: T, keys: string[], strategy: 'omit' | 'include'): T {
    if (typeof data !== 'object' || data === null) return data;
    
    const result = { ...data } as any;
    
    if (strategy === 'omit') {
      keys.forEach(key => delete result[key]);
    } else if (strategy === 'include') {
      const filtered = {} as any;
      keys.forEach(key => {
        if (key in result) {
          filtered[key] = result[key];
        }
      });
      return filtered;
    }
    
    return result;
  }

  function reset() {
    set(initialData);
  }

  function destroy() {
    if (saveTimeout) clearTimeout(saveTimeout);
    if (syncTimeout) clearTimeout(syncTimeout);
    unsubscribe();
  }

  return {
    subscribe,
    set: (value: T) => {
      set(value);
      scheduleSync();
    },
    update: (updater: (value: T) => T) => {
      update(updater);
      scheduleSync();
    },
    sync,
    load,
    save,
    reset,
    destroy
  };
}

// Global store manager instance
export const storeManager = new StoreManager();
