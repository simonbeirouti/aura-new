import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { cacheManager, cacheKeys } from './cacheManager';
import { createEnhancedStore, storeManager } from './core/storeManager';
import { toast } from 'svelte-sonner';
import { loadingStore } from './loadingStore';
import type { Product } from './userStore';

// Purchase state interface
export interface PurchaseState {
  products: Product[];
  loading: boolean;
  error: string | null;
  purchaseLoading: { [productId: string]: boolean };
  purchaseErrors: { [productId: string]: string };
  lastUpdated: number;
}

// Initial state
const initialState: PurchaseState = {
  products: [],
  loading: false,
  error: null,
  purchaseLoading: {},
  purchaseErrors: {},
  lastUpdated: 0
};

// Cache configuration for products
const PRODUCTS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (daily)
const PRODUCTS_CACHE_KEY = 'products_list';

// Helper function to check if it's a new day
function isNewDay(lastUpdated: number): boolean {
  const lastUpdateDate = new Date(lastUpdated);
  const today = new Date();
  return lastUpdateDate.toDateString() !== today.toDateString();
}

// Create enhanced purchase store
const purchaseStore = createEnhancedStore('purchase_store', initialState, {
  saveOnChange: true,
  saveStrategy: 'debounce',
  saveInterval: 2000,
  autoStart: true,
  filterKeys: ['loading', 'purchaseLoading'], // Don't persist loading states
  filterKeysStrategy: 'omit'
});

// Register with store manager
storeManager.registerStore('purchase', purchaseStore);

// Enhanced purchase store with caching
class PurchaseManager {
  public store = purchaseStore;

  get subscribe() {
    return this.store.subscribe;
  }

  // Load products with caching and loading state management
  async loadProducts(forceRefresh = false, showToastOnError = true): Promise<void> {
    // Use loadingStore for consistent loading state
    loadingStore.show({ id: 'products' });

    this.store.update(state => ({ ...state, loading: true, error: null }));

    try {
      let products: Product[];

      if (!forceRefresh) {
        // Try to get from cache first
        const cached = cacheManager.get<Product[]>(PRODUCTS_CACHE_KEY);
        if (cached) {
          this.store.update(state => ({
            ...state,
            products: cached,
            loading: false,
            lastUpdated: Date.now()
          }));
          loadingStore.hide('products');
          return;
        }
      }

      // Load from backend
      products = await invoke<Product[]>('get_products');

      // Cache the results
      cacheManager.set(PRODUCTS_CACHE_KEY, products, PRODUCTS_CACHE_TTL);

      this.store.update(state => ({
        ...state,
        products,
        loading: false,
        lastUpdated: Date.now()
      }));

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load products';
      this.store.update(state => ({
        ...state,
        error: errorMessage,
        loading: false
      }));

      // Only show toast if explicitly requested (not during initial auth)
      if (showToastOnError) {
        toast.error('Failed to load products');
      }

      throw err; // Re-throw to allow calling code to handle
    } finally {
      loadingStore.hide('products');
    }
  }

  // Purchase product with cache invalidation and deduplication
  async purchaseProduct(productId: string, userId: string): Promise<{ purchase: any }> {
    // Check if purchase is already in progress for this product
    const currentState = get(this.store);
    if (currentState.purchaseLoading[productId]) {
      throw new Error('Purchase already in progress');
    }

    this.store.update(state => ({
      ...state,
      purchaseLoading: { ...state.purchaseLoading, [productId]: true },
      purchaseErrors: { ...state.purchaseErrors, [productId]: '' }
    }));

    try {
      // Get the product to calculate new token balance
      const product = this.getProduct(productId);
      if (!product) {
        throw new Error('Product not found');
      }

      // Pre-purchase eligibility check - check against database in real-time
      try {
        const canPurchase = await invoke<boolean>('can_purchase_product', { userId, productId });

        if (!canPurchase) {
          throw new Error('INSUFFICIENT_TOKENS');
        }
      } catch (eligibilityError) {
        if (eligibilityError instanceof Error && eligibilityError.message === 'INSUFFICIENT_TOKENS') {
          // Re-throw with specific error for UI handling
          throw new Error('INSUFFICIENT_TOKENS');
        }
        // If eligibility check fails for other reasons, continue (might be network issue)
      }

      // Execute purchase through Tauri backend
      const purchase = await invoke('purchase_product', { productId, userId });

      // Invalidate relevant caches
      cacheManager.handlePurchaseCompletion(userId);

      // Also invalidate products cache in case purchase affects availability
      cacheManager.delete(PRODUCTS_CACHE_KEY);

      // Clear purchase error for this product
      this.clearPurchaseError(productId);

      // Return purchase result
      return {
        purchase
      };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Purchase failed';

      // Store error in state for UI feedback
      this.store.update(state => ({
        ...state,
        purchaseErrors: { ...state.purchaseErrors, [productId]: errorMessage }
      }));

      // Show toast error with more details
      const detailedError = err instanceof Error ? `${err.message}` : 'Unknown purchase error';
      toast.error(`Purchase failed: ${detailedError}`);
      throw err;
    } finally {
      this.store.update(state => ({
        ...state,
        purchaseLoading: { ...state.purchaseLoading, [productId]: false }
      }));
    }
  }

  // Get product by ID
  getProduct(productId: string): Product | undefined {
    const state = get(this.store);
    return state.products.find(p => p.id === productId);
  }

  // Get purchase loading state for a product
  getPurchaseLoadingState(productId: string): boolean {
    const state = get(this.store);
    return state.purchaseLoading[productId] || false;
  }

  // Check if products need refresh (daily or if cache expired)
  shouldRefresh(): boolean {
    const state = get(this.store);
    const cacheAge = Date.now() - state.lastUpdated;

    // Force refresh if it's a new day or cache is expired
    const needsDailyRefresh = state.lastUpdated > 0 && isNewDay(state.lastUpdated);
    const cacheExpired = cacheAge > PRODUCTS_CACHE_TTL;
    const noCache = !cacheManager.has(PRODUCTS_CACHE_KEY);

    return needsDailyRefresh || cacheExpired || noCache;
  }

  // Refresh products if needed
  async refreshIfNeeded(showToastOnError = true): Promise<void> {
    if (this.shouldRefresh()) {
      await this.loadProducts(true, showToastOnError);
    }
  }

  // Clear purchase errors
  clearPurchaseError(productId: string): void {
    this.store.update(state => ({
      ...state,
      purchaseErrors: { ...state.purchaseErrors, [productId]: '' }
    }));
  }

  // Clear all purchase errors
  clearAllPurchaseErrors(): void {
    this.store.update(state => ({
      ...state,
      purchaseErrors: {}
    }));
  }
}

// Create and export purchase manager instance
export const purchaseManager = new PurchaseManager();

// Handle app visibility changes to clear stale purchase states
let visibilityListenerAdded = false;
if (typeof document !== 'undefined' && !visibilityListenerAdded) {
  visibilityListenerAdded = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      purchaseManager.clearAllPurchaseErrors();

      // Clear any loading states that might be stuck
      purchaseManager.store.update(state => ({
        ...state,
        purchaseLoading: {},
        purchaseErrors: {}
      }));
    }
  });
}

// Derived stores for convenient access
export const products = derived(
  purchaseManager,
  ($purchase) => $purchase.products
);

export const productsLoading = derived(
  purchaseManager,
  ($purchase) => $purchase.loading
);

export const productsError = derived(
  purchaseManager,
  ($purchase) => $purchase.error
);

export const purchaseLoading = derived(
  purchaseManager,
  ($purchase) => $purchase.purchaseLoading
);

export const purchaseErrors = derived(
  purchaseManager,
  ($purchase) => $purchase.purchaseErrors
);

// Helper function to get products by category
export const productsByCategory = derived(
  products,
  ($products) => {
    const categories: { [key: string]: Product[] } = {};

    $products.forEach(product => {
      const category = product.category || 'Other';
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(product);
    });

    return categories;
  }
);

// Add reset method to existing purchaseManager
Object.assign(purchaseManager, {
  reset: () => {
    purchaseStore.set(initialState);
  }
});

// Product loading is now handled by unifiedAuth initialization
// to prevent loading during auth completion and ensure consistent state management
