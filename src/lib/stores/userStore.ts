import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { getUserTokenBalance, getUserSubscriptionsWithSync, syncSubscriptionsWithIAP, type UserSubscriptionRecord } from '$lib/utils/iapDatabase';
import { invoke } from '@tauri-apps/api/core';
import { iapStore } from './iapStore';

/**
 * Format a number with commas for thousands separators
 */
function formatNumberWithCommas(num: number): string {
  return num.toLocaleString();
}

export interface UserTokenBalance {
  total_tokens: number;
  tokens_used: number;
  tokens_available: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  token_cost: number;
  category: string;
  is_active: boolean;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface Purchase {
  id: string;
  user_id: string;
  product_id: string;
  token_cost: number;
  purchase_status: 'pending' | 'completed' | 'failed' | 'refunded';
  transaction_id: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserState {
  // Token management
  tokenBalance: UserTokenBalance;
  tokenLoading: boolean;
  tokenError: string | null;
  
  // Subscription management
  subscriptions: UserSubscriptionRecord[];
  subscriptionLoading: boolean;
  subscriptionError: string | null;
  
  // Purchase management
  purchaseLoading: boolean;
  purchaseError: string | null;
  
  // Cache management
  lastTokenUpdate: number | null;
  lastSubscriptionUpdate: number | null;
  cacheValidDuration: number; // 5 minutes
  
  // User info
  userId: string | null;
  isInitialized: boolean;
}

function createUserStore() {
  const initialState: UserState = {
    tokenBalance: { total_tokens: 0, tokens_used: 0, tokens_available: 0 },
    tokenLoading: false,
    tokenError: null,
    subscriptions: [],
    subscriptionLoading: false,
    subscriptionError: null,
    purchaseLoading: false,
    purchaseError: null,
    lastTokenUpdate: null,
    lastSubscriptionUpdate: null,
    cacheValidDuration: 5 * 60 * 1000, // 5 minutes
    userId: null,
    isInitialized: false
  };

  const { subscribe, update, set } = writable<UserState>(initialState);

  /**
   * Initialize the store with user ID
   */
  async function initialize(userId: string): Promise<void> {
    if (!browser) return;
    
    update(state => ({
      ...state,
      userId,
      isInitialized: true
    }));

    // Load initial data
    await Promise.all([
      refreshTokenBalance(false),
      refreshSubscriptions(false)
    ]);
  }

  /**
   * Refresh token balance from database
   */
  async function refreshTokenBalance(force = false): Promise<void> {
    const currentState = get({ subscribe });

    if (!currentState.userId) {
      return;
    }

    const now = Date.now();
    const cacheValid = currentState.lastTokenUpdate &&
      (now - currentState.lastTokenUpdate) < currentState.cacheValidDuration;

    if (!force && cacheValid) {
      return;
    }

    update(state => ({ ...state, tokenLoading: true, tokenError: null }));

    try {
      const balance = await getUserTokenBalance(currentState.userId);

      // Validate balance data
      if (typeof balance.tokens_available !== 'number' ||
          typeof balance.tokens_used !== 'number' ||
          typeof balance.total_tokens !== 'number') {
        throw new Error('Invalid balance data structure');
      }

      update(state => ({
        ...state,
        tokenBalance: balance,
        tokenLoading: false,
        tokenError: null,
        lastTokenUpdate: now
      }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load token balance';

      update(state => ({
        ...state,
        tokenLoading: false,
        tokenError: errorMessage
      }));
    }
  }

  /**
   * Refresh subscriptions from database with automatic IAP sync
   */
  async function refreshSubscriptions(force = false): Promise<void> {
    const currentState = get({ subscribe });
    
    if (!currentState.userId) return;
    
    const now = Date.now();
    const cacheValid = currentState.lastSubscriptionUpdate && 
      (now - currentState.lastSubscriptionUpdate) < currentState.cacheValidDuration;
    
    if (!force && cacheValid) {
      return;
    }

    update(state => ({ ...state, subscriptionLoading: true, subscriptionError: null }));

    try {
      // Use the sync version that automatically checks IAP status
      const subscriptions = await getUserSubscriptionsWithSync(currentState.userId);
      
      update(state => ({
        ...state,
        subscriptions,
        subscriptionLoading: false,
        subscriptionError: null,
        lastSubscriptionUpdate: now
      }));
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load subscriptions';
      
      update(state => ({
        ...state,
        subscriptionLoading: false,
        subscriptionError: errorMessage
      }));
    }
  }

  /**
   * Update token balance after a purchase or usage
   */
  async function updateTokenBalance(newBalance?: UserTokenBalance): Promise<void> {
    if (newBalance) {
      // Direct update with provided balance
      update(state => ({
        ...state,
        tokenBalance: newBalance,
        lastTokenUpdate: Date.now()
      }));
    } else {
      // Refresh from database
      await refreshTokenBalance(true);
    }
  }

  /**
   * Immediately update token balance after a purchase (optimistic update)
   */
  function updateTokenBalanceAfterPurchase(tokenCost: number): void {
    update(state => {
      const newTokensUsed = state.tokenBalance.tokens_used + tokenCost;
      const newTokensAvailable = state.tokenBalance.total_tokens - newTokensUsed;
      
      return {
        ...state,
        tokenBalance: {
          ...state.tokenBalance,
          tokens_used: newTokensUsed,
          tokens_available: newTokensAvailable
        },
        lastTokenUpdate: Date.now()
      };
    });
  }

  /**
   * Update subscriptions after a purchase or status change
   */
  async function updateSubscriptions(newSubscriptions?: UserSubscriptionRecord[]): Promise<void> {
    if (newSubscriptions) {
      // Direct update with provided subscriptions
      update(state => ({
        ...state,
        subscriptions: newSubscriptions,
        lastSubscriptionUpdate: Date.now()
      }));
    } else {
      // Refresh from database
      await refreshSubscriptions(true);
    }
  }

  /**
   * Check if user has an active subscription for a specific product
   */
  function hasActiveSubscription(productId?: string): boolean {
    const currentState = get({ subscribe });
    
    if (productId) {
      return currentState.subscriptions.some(
        sub => sub.product_id === productId && sub.subscription_status === 'active'
      );
    }
    
    return currentState.subscriptions.some(
      sub => sub.subscription_status === 'active'
    );
  }

  /**
   * Check if user has sufficient tokens
   */
  function hasSufficientTokens(required: number): boolean {
    const currentState = get({ subscribe });
    return currentState.tokenBalance.tokens_available >= required;
  }

  /**
   * Get active subscription for a specific product
   */
  function getActiveSubscription(productId: string): UserSubscriptionRecord | null {
    const currentState = get({ subscribe });
    return currentState.subscriptions.find(
      sub => sub.product_id === productId && sub.subscription_status === 'active'
    ) || null;
  }

  /**
   * Start periodic subscription status checking with IAP sync
   */
  function startPeriodicChecks(): void {
    if (!browser) return;
    
    // Check subscriptions and tokens every 30 minutes
    const subscriptionInterval = setInterval(() => {
      // Only refresh if user is initialized and not currently loading
      const currentState = get({ subscribe });
      if (currentState.isInitialized && !currentState.tokenLoading && !currentState.subscriptionLoading) {
        refreshSubscriptions(true);
        refreshTokenBalance(true);
      }
    }, 30 * 60 * 1000); // Combined check every 30 minutes
    
    // Comprehensive IAP sync check every 15 minutes (with reduced logging)
    const iapSyncInterval = setInterval(async () => {
      const currentState = get({ subscribe });
      
      if (currentState.userId) {
        try {
          // Restore purchases to get latest subscription status from Apple
          await iapStore.restorePurchases("subs");
          
          // Sync IAP status changes to database
          const syncResult = await syncSubscriptionsWithIAP(currentState.userId);
          
          if (syncResult.updated > 0) {
            // Refresh user store to reflect database changes
            await refreshSubscriptions(true);
          }

          if (syncResult.errors.length > 0) {
            // Continue silently on sync errors
          }
        } catch (error) {
          // Continue silently on IAP sync check failures
        }
      }
    }, 15 * 60 * 1000); // Every 15 minutes

    // Store intervals for cleanup
    if (browser && typeof window !== 'undefined') {
      (window as any).__userStoreIntervals = {
        subscription: subscriptionInterval,
        iapSync: iapSyncInterval
      };
    }
  }

  /**
   * Stop periodic checks
   */
  function stopPeriodicChecks(): void {
    if (browser && typeof window !== 'undefined' && (window as any).__userStoreIntervals) {
      clearInterval((window as any).__userStoreIntervals.subscription);
      clearInterval((window as any).__userStoreIntervals.iapSync);
      delete (window as any).__userStoreIntervals;
    }
  }

  /**
   * Purchase a product with tokens
   */
  async function purchaseProduct(productId: string): Promise<Purchase> {
    const currentState = get({ subscribe });
    
    if (!currentState.userId) {
      throw new Error('User not initialized');
    }

    update(state => ({ ...state, purchaseLoading: true, purchaseError: null }));

    try {
      // Call Tauri command to process purchase
      const purchase = await invoke<Purchase>('purchase_product', {
        userId: currentState.userId,
        productId
      });

      // Refresh token balance after successful purchase
      await refreshTokenBalance(true);

      update(state => ({ ...state, purchaseLoading: false, purchaseError: null }));
      
      return purchase;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Purchase failed';
      
      update(state => ({
        ...state,
        purchaseLoading: false,
        purchaseError: errorMessage
      }));
      
      throw error;
    }
  }

  /**
   * Get available products
   */
  async function getProducts(): Promise<Product[]> {
    try {
      return await invoke<Product[]>('get_products');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get user's purchase history
   */
  async function getPurchaseHistory(): Promise<Purchase[]> {
    const currentState = get({ subscribe });

    if (!currentState.userId) {
      throw new Error('User not initialized');
    }

    try {
      return await invoke<Purchase[]>('get_user_purchases', {
        userId: currentState.userId
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Reset store state
   */
  function reset(): void {
    stopPeriodicChecks();
    set(initialState);
  }

  return {
    subscribe,
    initialize,
    refreshTokenBalance,
    refreshSubscriptions,
    updateTokenBalance,
    updateTokenBalanceAfterPurchase,
    updateSubscriptions,
    hasActiveSubscription,
    hasSufficientTokens,
    getActiveSubscription,
    purchaseProduct,
    getProducts,
    getPurchaseHistory,
    startPeriodicChecks,
    stopPeriodicChecks,
    reset
  };
}

// Create and export the user store instance
export const userStore = createUserStore();

// Derived stores for common use cases
export const tokenBalance = derived(
  userStore,
  ($user: UserState) => $user.tokenBalance
);

export const availableTokens = derived(
  userStore,
  ($user: UserState) => $user.tokenBalance.tokens_available
);

export const activeSubscriptions = derived(
  userStore,
  ($user: UserState) => $user.subscriptions.filter(sub => sub.subscription_status === 'active')
);

export const hasAnyActiveSubscription = derived(
  userStore,
  ($user: UserState) => $user.subscriptions.some(sub => sub.subscription_status === 'active')
);

export const isUserDataLoading = derived(
  userStore,
  ($user: UserState) => $user.tokenLoading || $user.subscriptionLoading
);

export const userDataErrors = derived(
  userStore,
  ($user: UserState) => ({
    tokenError: $user.tokenError,
    subscriptionError: $user.subscriptionError,
    hasErrors: !!$user.tokenError || !!$user.subscriptionError
  })
);

// Formatted token stores with comma separators
export const formattedTokenBalance = derived(
  userStore,
  ($user: UserState) => ({
    total_tokens: formatNumberWithCommas($user.tokenBalance.total_tokens),
    tokens_used: formatNumberWithCommas($user.tokenBalance.tokens_used),
    tokens_available: formatNumberWithCommas($user.tokenBalance.tokens_available)
  })
);

export const formattedAvailableTokens = derived(
  userStore,
  ($user: UserState) => formatNumberWithCommas($user.tokenBalance.tokens_available)
);

export const formattedTotalTokens = derived(
  userStore,
  ($user: UserState) => formatNumberWithCommas($user.tokenBalance.total_tokens)
);

export const formattedUsedTokens = derived(
  userStore,
  ($user: UserState) => formatNumberWithCommas($user.tokenBalance.tokens_used)
);

// Handle app visibility changes to sync balance when app comes to foreground
if (browser && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Get current state to check if we have a user
      let currentState: any = null;
      const unsubscribe = userStore.subscribe((state) => {
        currentState = state;
      });
      unsubscribe();

      if (currentState?.isInitialized && currentState?.userId) {
        // Refresh balance when app comes to foreground
        // This ensures balance is correct if purchases happened while app was backgrounded
        setTimeout(async () => {
          try {
            await userStore.refreshTokenBalance(true);
          } catch (error) {
            // Continue silently on sync failure
          }
        }, 1000); // Small delay to allow other initialization to complete
      }
    }
  });
}

// Auto-start periodic checks when store is initialized
if (browser) {
  userStore.subscribe((state) => {
    if (state.isInitialized && state.userId) {
      // Start periodic checks after initialization
      setTimeout(() => {
        userStore.startPeriodicChecks();
      }, 10000);
    }
  });
}
