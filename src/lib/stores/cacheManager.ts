import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

// Cache entry interface
export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  key: string;
  version: number;
}

// Cache configuration
export interface CacheConfig {
  defaultTTL: number;
  maxSize: number;
  persistToDisk: boolean;
  autoCleanup: boolean;
  cleanupInterval: number;
}

// Cache store state
interface CacheState {
  entries: Map<string, CacheEntry>;
  config: CacheConfig;
  stats: {
    hits: number;
    misses: number;
    evictions: number;
    lastCleanup: number;
  };
}

// Default cache configuration
const defaultConfig: CacheConfig = {
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  maxSize: 1000, // Max 1000 entries
  persistToDisk: true,
  autoCleanup: true,
  cleanupInterval: 60 * 1000 // Cleanup every minute
};

// Initial cache state
const initialState: CacheState = {
  entries: new Map(),
  config: defaultConfig,
  stats: {
    hits: 0,
    misses: 0,
    evictions: 0,
    lastCleanup: Date.now()
  }
};

// Create unified cache manager
class CacheManager {
  private store = writable<CacheState>(initialState);
  private cleanupTimer: NodeJS.Timeout | null = null;
  private persistenceTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.initialize();
  }

  // Store interface
  get subscribe() {
    return this.store.subscribe;
  }

  // Initialize cache manager
  private async initialize() {
    // Load persisted cache from disk
    await this.loadFromDisk();

    // Validate cache integrity after loading
    await this.validateCacheIntegrity();

    // Start cleanup timer
    this.startCleanupTimer();

    // Start persistence timer
    this.startPersistenceTimer();
  }

  // Get data from cache
  get<T>(key: string): T | null {
    const state = get(this.store);
    const entry = state.entries.get(key);

    if (!entry) {
      this.updateStats('miss');
      return null;
    }

    // Check if entry is expired
    if (this.isExpired(entry)) {
      this.delete(key);
      this.updateStats('miss');
      return null;
    }

    this.updateStats('hit');
    return entry.data as T;
  }

  // Set data in cache
  set<T>(key: string, data: T, ttl?: number): void {
    const state = get(this.store);
    const now = Date.now();
    
    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      ttl: ttl || state.config.defaultTTL,
      key,
      version: 1
    };

    // Check if we need to evict entries
    if (state.entries.size >= state.config.maxSize) {
      this.evictOldest();
    }

    // Add new entry
    const newEntries = new Map(state.entries);
    newEntries.set(key, entry);

    this.store.update(s => ({
      ...s,
      entries: newEntries
    }));
  }

  // Delete entry from cache
  delete(key: string): boolean {
    const state = get(this.store);
    const newEntries = new Map(state.entries);
    const deleted = newEntries.delete(key);

    if (deleted) {
      this.store.update(s => ({
        ...s,
        entries: newEntries
      }));
    }

    return deleted;
  }

  // Check if entry exists and is valid
  has(key: string): boolean {
    const state = get(this.store);
    const entry = state.entries.get(key);
    return entry ? !this.isExpired(entry) : false;
  }

  // Clear all cache entries
  clear(): void {
    this.store.update(s => ({
      ...s,
      entries: new Map()
    }));
  }

  // Invalidate entries by pattern
  invalidatePattern(pattern: string | RegExp): number {
    const state = get(this.store);
    const newEntries = new Map(state.entries);
    let count = 0;

    for (const key of newEntries.keys()) {
      const matches = typeof pattern === 'string' 
        ? key.includes(pattern)
        : pattern.test(key);
      
      if (matches) {
        newEntries.delete(key);
        count++;
      }
    }

    this.store.update(s => ({
      ...s,
      entries: newEntries
    }));

    return count;
  }

  // Get or set with async loader
  async getOrSet<T>(
    key: string, 
    loader: () => Promise<T>, 
    ttl?: number
  ): Promise<T> {
    // Try to get from cache first
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Load data and cache it
    try {
      const data = await loader();
      this.set(key, data, ttl);
      return data;
    } catch (error) {
      throw error;
    }
  }

  // Refresh cache entry
  async refresh<T>(key: string, loader: () => Promise<T>, ttl?: number): Promise<T> {
    try {
      const data = await loader();
      this.set(key, data, ttl);
      return data;
    } catch (error) {
      throw error;
    }
  }

  // Check if entry is expired
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  // Update cache statistics
  private updateStats(type: 'hit' | 'miss' | 'eviction'): void {
    this.store.update(s => ({
      ...s,
      stats: {
        ...s.stats,
        [type === 'hit' ? 'hits' : type === 'miss' ? 'misses' : 'evictions']: 
          s.stats[type === 'hit' ? 'hits' : type === 'miss' ? 'misses' : 'evictions'] + 1
      }
    }));
  }

  // Evict oldest entry
  private evictOldest(): void {
    const state = get(this.store);
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of state.entries) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
      this.updateStats('eviction');
    }
  }

  // Cleanup expired entries
  private cleanup(): void {
    const state = get(this.store);
    const newEntries = new Map(state.entries);
    let cleaned = 0;

    for (const [key, entry] of newEntries) {
      if (this.isExpired(entry)) {
        newEntries.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.store.update(s => ({
        ...s,
        entries: newEntries,
        stats: {
          ...s.stats,
          lastCleanup: Date.now()
        }
      }));
    }
  }

  // Start cleanup timer
  private startCleanupTimer(): void {
    const state = get(this.store);
    if (state.config.autoCleanup && !this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, state.config.cleanupInterval);
    }
  }

  // Start persistence timer
  private startPersistenceTimer(): void {
    const state = get(this.store);
    if (state.config.persistToDisk && !this.persistenceTimer) {
      this.persistenceTimer = setInterval(() => {
        this.saveToDisk();
      }, 30000); // Save every 30 seconds
    }
  }

  // Validate cache integrity and clean up invalid entries
  private async validateCacheIntegrity(): Promise<void> {
    const state = get(this.store);
    const now = Date.now();
    const entriesToRemove: string[] = [];

    // Check for entries that are expired or have invalid data
    for (const [key, entry] of state.entries) {
      // Remove expired entries
      if (this.isExpired(entry)) {
        entriesToRemove.push(key);
        continue;
      }

      // Remove entries older than 24 hours (force refresh for stale data)
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      if (now - entry.timestamp > maxAge) {
        entriesToRemove.push(key);
        continue;
      }

      // Validate entry structure
      if (!entry.data || !entry.timestamp || !entry.ttl || !entry.key) {
        entriesToRemove.push(key);
        continue;
      }
    }

    // Remove invalid entries
    if (entriesToRemove.length > 0) {
      this.store.update(s => {
        const newEntries = new Map(s.entries);
        entriesToRemove.forEach(key => newEntries.delete(key));
        return {
          ...s,
          entries: newEntries
        };
      });
    }
  }

  // Load cache from disk
  private async loadFromDisk(): Promise<void> {
    try {
      const cacheData = await invoke<any>('store_get', { storeId: 'cache_manager' });
      if (cacheData && cacheData.entries) {
        const entries = new Map();

        // Convert array back to Map and filter expired entries
        for (const [key, entry] of Object.entries(cacheData.entries)) {
          if (!this.isExpired(entry as CacheEntry)) {
            entries.set(key, entry);
          }
        }

        this.store.update(s => ({
          ...s,
          entries,
          stats: cacheData.stats || s.stats
        }));
      }
    } catch (error) {
      // Continue silently on cache load failure
    }
  }

  // Save cache to disk
  private async saveToDisk(): Promise<void> {
    try {
      const state = get(this.store);
      
      // Convert Map to object for serialization
      const entriesObj: Record<string, CacheEntry> = {};
      for (const [key, entry] of state.entries) {
        if (!this.isExpired(entry)) {
          entriesObj[key] = entry;
        }
      }

      await invoke('store_set', {
        storeId: 'cache_manager',
        data: {
          entries: entriesObj,
          stats: state.stats,
          lastSaved: Date.now()
        }
      });
    } catch (error) {
      // Continue silently on cache save failure
    }
  }

  // Get cache statistics
  getStats() {
    const state = get(this.store);
    return {
      ...state.stats,
      size: state.entries.size,
      hitRate: state.stats.hits / (state.stats.hits + state.stats.misses) || 0
    };
  }

  // Handle purchase completion - invalidate relevant caches
  handlePurchaseCompletion(userId: string): void {
    // Invalidate all user-specific data that might change after purchase
    const keysToInvalidate = [
      cacheKeys.profile(userId),
      cacheKeys.userTokenBalance(userId),
      cacheKeys.userPurchases(userId),
      cacheKeys.packages() // Package data might include user-specific access info
    ];

    let invalidatedCount = 0;
    keysToInvalidate.forEach(key => {
      if (this.delete(key)) {
        invalidatedCount++;
      }
    });
  }

  // Invalidate all user-specific cache entries (useful for logout)
  invalidateUserCache(userId: string): number {
    const pattern = new RegExp(`.*${userId}.*`);
    const invalidatedCount = this.invalidatePattern(pattern);
    return invalidatedCount;
  }

  // Force refresh cache for specific patterns
  async refreshCacheForPattern(pattern: string | RegExp, maxAge: number = 5 * 60 * 1000): Promise<void> {
    const state = get(this.store);
    const now = Date.now();
    const entriesToRefresh: string[] = [];

    for (const [key, entry] of state.entries) {
      const matches = typeof pattern === 'string'
        ? key.includes(pattern)
        : pattern.test(key);

      if (matches && (now - entry.timestamp) > maxAge) {
        entriesToRefresh.push(key);
      }
    }

    // Remove stale entries to force refresh
    if (entriesToRefresh.length > 0) {
      this.store.update(s => {
        const newEntries = new Map(s.entries);
        entriesToRefresh.forEach(key => newEntries.delete(key));
        return {
          ...s,
          entries: newEntries
        };
      });
    }
  }

  // Destroy cache manager
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = null;
    }
    
    this.saveToDisk(); // Final save
  }
}

// Create and export cache manager instance
export const cacheManager = new CacheManager();

// Derived store for cache statistics
export const cacheStats = derived(
  cacheManager,
  ($cache) => ({
    size: $cache.entries.size,
    hits: $cache.stats.hits,
    misses: $cache.stats.misses,
    evictions: $cache.stats.evictions,
    hitRate: $cache.stats.hits / ($cache.stats.hits + $cache.stats.misses) || 0,
    lastCleanup: $cache.stats.lastCleanup
  })
);

// Cache key generators for consistent naming
export const cacheKeys = {
  profile: (userId: string) => `profile:${userId}`,
  paymentMethods: (userId: string) => `payment_methods:${userId}`,
  subscription: (userId: string) => `subscription:${userId}`,
  stripeCustomer: (userId: string) => `stripe_customer:${userId}`,
  stripeProduct: (productId: string) => `stripe_product:${productId}`,
  userPattern: (userId: string) => `*:${userId}*`,
  // Purchase-related cache keys
  userTokenBalance: (userId: string) => `token_balance:${userId}`,
  userPurchases: (userId: string) => `purchases:${userId}`,
  packages: () => 'packages_with_prices',
  // KYC and contractor-related cache keys
  contractorStatus: (userId: string) => `contractor_status:${userId}`,
  kycFormData: (userId: string) => `kyc_form_data:${userId}`,
  connectAccountStatus: (accountId: string) => `connect_account_status:${accountId}`,
  onboardingUrl: (accountId: string) => `onboarding_url:${accountId}`
};

// Cleanup on app close
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    cacheManager.destroy();
  });
}
