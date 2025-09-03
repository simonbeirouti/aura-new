import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { cacheManager, cacheKeys } from './cacheManager';
import { createEnhancedStore, storeManager } from './core/storeManager';
import { toast } from 'svelte-sonner';
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
const PRODUCTS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const PRODUCTS_CACHE_KEY = 'products_list';

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
  private store = purchaseStore;

  get subscribe() {
    return this.store.subscribe;
  }

  // Load products with caching
  async loadProducts(forceRefresh = false): Promise<void> {
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
      toast.error('Failed to load products');
      console.error('Failed to load products:', err);
    }
  }

  // Purchase product with cache invalidation
  async purchaseProduct(productId: string, userId: string): Promise<{ purchase: any; newTokenBalance: any }> {
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

      // Execute purchase
      const purchase = await invoke('purchase_product', { productId, userId });

      // Invalidate relevant caches
      cacheManager.handlePurchaseCompletion(userId);
      
      // Also invalidate products cache in case purchase affects availability
      cacheManager.delete(PRODUCTS_CACHE_KEY);

      // Return purchase result and token cost for immediate balance update
      return { 
        purchase, 
        newTokenBalance: { tokenCost: product.token_cost }
      };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Purchase failed';
      
      // Show toast error instead of storing in state
      toast.error(`Purchase failed: ${errorMessage}`);
      console.error('Purchase failed:', err);
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

  // Check if products need refresh
  shouldRefresh(): boolean {
    const state = get(this.store);
    const cacheAge = Date.now() - state.lastUpdated;
    return cacheAge > PRODUCTS_CACHE_TTL || !cacheManager.has(PRODUCTS_CACHE_KEY);
  }

  // Refresh products if needed
  async refreshIfNeeded(): Promise<void> {
    if (this.shouldRefresh()) {
      await this.loadProducts(true);
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

// Initialize store conditionally based on auth state
if (typeof window !== 'undefined') {
  // Import auth store to check authentication status
  import('./unifiedAuth.js').then(({ authStore }) => {
    // Subscribe to auth changes and load products when authenticated
    authStore.subscribe((authState) => {
      if (authState.isAuthenticated && authState.user) {
        // Only load products if we haven't loaded them yet or if we need a refresh
        if (purchaseManager.shouldRefresh()) {
          purchaseManager.loadProducts().catch(() => {
            // Silently handle errors - they're already logged in loadProducts
          });
        }
      }
    });
  }).catch(() => {
    // Auth store not available, skip auto-loading
  });
}
