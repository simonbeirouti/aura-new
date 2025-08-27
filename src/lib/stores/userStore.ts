import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { getUserTokenBalance, getUserSubscriptions, type UserSubscriptionRecord } from '$lib/utils/iapDatabase';

export interface UserTokenBalance {
  total_tokens: number;
  tokens_used: number;
  tokens_available: number;
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
    
    if (!currentState.userId) return;
    
    const now = Date.now();
    const cacheValid = currentState.lastTokenUpdate && 
      (now - currentState.lastTokenUpdate) < currentState.cacheValidDuration;
    
    if (!force && cacheValid) {
      return;
    }

    update(state => ({ ...state, tokenLoading: true, tokenError: null }));

    try {
      const balance = await getUserTokenBalance(currentState.userId);
      
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
   * Refresh subscriptions from database
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
      const subscriptions = await getUserSubscriptions(currentState.userId);
      
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
   * Start periodic subscription status checking
   */
  function startPeriodicChecks(): void {
    if (!browser) return;
    
    // Check subscriptions every 30 minutes
    const subscriptionInterval = setInterval(() => {
      refreshSubscriptions(true);
    }, 30 * 60 * 1000);

    // Check tokens every 10 minutes (in case of external changes)
    const tokenInterval = setInterval(() => {
      refreshTokenBalance(true);
    }, 10 * 60 * 1000);

    // Store intervals for cleanup
    if (browser && typeof window !== 'undefined') {
      (window as any).__userStoreIntervals = {
        subscription: subscriptionInterval,
        token: tokenInterval
      };
    }
  }

  /**
   * Stop periodic checks
   */
  function stopPeriodicChecks(): void {
    if (browser && typeof window !== 'undefined' && (window as any).__userStoreIntervals) {
      clearInterval((window as any).__userStoreIntervals.subscription);
      clearInterval((window as any).__userStoreIntervals.token);
      delete (window as any).__userStoreIntervals;
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
    updateSubscriptions,
    hasActiveSubscription,
    hasSufficientTokens,
    getActiveSubscription,
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

// Auto-start periodic checks when store is initialized
if (browser) {
  userStore.subscribe((state) => {
    if (state.isInitialized && state.userId) {
      // Start periodic checks after initialization
      setTimeout(() => {
        userStore.startPeriodicChecks();
      }, 1000);
    }
  });
}
