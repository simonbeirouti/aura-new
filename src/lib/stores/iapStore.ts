import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import {
  initialize,
  getProducts,
  purchase,
  restorePurchases,
  acknowledgePurchase,
  onPurchaseUpdated
} from '@choochmeque/tauri-plugin-iap-api';

// IAP Plugin API types matching Swift implementation
export interface Product {
  productId: string;
  title?: string;
  description?: string;
  productType?: string;
  formattedPrice?: string;
  priceCurrencyCode?: string;
  subscriptionOfferDetails?: SubscriptionOffer[];
}

export interface SubscriptionOffer {
  offerToken: string;
  basePlanId: string;
  offerId?: string;
  pricingPhases: PricingPhase[];
}

export interface PricingPhase {
  formattedPrice: string;
  priceCurrencyCode: string;
  priceAmountMicros: number;
  billingPeriod: string;
  billingCycleCount: number;
  recurrenceMode: number;
}

export interface Purchase {
  orderId?: string;
  packageName?: string;
  productId: string;
  purchaseTime?: number;
  purchaseToken: string;
  purchaseState: number; // 0 = purchased, 1 = canceled
  isAutoRenewing?: boolean;
  isAcknowledged?: boolean;
  originalJson?: string;
  signature?: string;
  // Subscription-specific fields
  expiryTime?: number;
  subscriptionStatus?: 'active' | 'expired' | 'cancelled' | 'pending';
  renewalDate?: number;
  cancellationDate?: number;
}

export interface Transaction {
  transactionId: string;
  productId: string;
  status: TransactionStatus;
  purchaseTime?: number;
  isAutoRenewing?: boolean;
  error?: string;
}

export enum TransactionStatus {
  pending = 'pending',
  purchased = 'purchased',
  failed = 'failed',
  restored = 'restored'
}

export interface Exception {
  message: string;
  code?: string;
}

interface IAPState {
  isInitialized: boolean;
  canMakePayments: boolean;
  countryCode: string | null;
  products: Product[];
  purchases: Purchase[];
  transactions: Transaction[];
  activeSubscriptions: Purchase[];
  isLoading: boolean;
  error: string | null;
  pluginAvailable: boolean;
  // Caching fields
  lastInitialized: number | null;
  lastProductsQuery: number | null;
  lastPurchasesRestore: number | null;
  cacheValidDuration: number; // milliseconds
}

// Create the main IAP store
function createIAPStore() {
  const store = writable<IAPState>({
    isInitialized: false,
    canMakePayments: false,
    countryCode: null,
    products: [],
    purchases: [],
    transactions: [],
    activeSubscriptions: [],
    isLoading: false,
    error: null,
    pluginAvailable: false,
    // Caching defaults
    lastInitialized: null,
    lastProductsQuery: null,
    lastPurchasesRestore: null,
    cacheValidDuration: 5 * 60 * 1000 // 5 minutes
  });

  const { subscribe, update } = store;


  async function isDesktopMacOS(): Promise<boolean> {
    try {
      const platformInfo = await invoke('get_platform_info');
      return (platformInfo as any)?.os === 'macos';
    } catch (error) {
      return false; // Assume not desktop macOS if we can't determine
    }
  }

  function checkPluginAvailability(operation: string): boolean {
    // Check if IAP functions are available
    if (typeof initialize !== 'function' || typeof getProducts !== 'function' || typeof purchase !== 'function') {
      const pluginErrorMsg = `${operation} not available - IAP plugin functions not loaded.`;
      update(state => ({
        ...state,
        error: pluginErrorMsg,
        pluginAvailable: false
      }));
      return false;
    }

    // Check current state
    const currentState = get(store);
    if (!currentState.pluginAvailable) {
      return false;
    }

    return true;
  }

  async function initializeIAP(forceRefresh = false): Promise<boolean> {
    const currentState = get(store);
    const now = Date.now();
    
    // Check if already initialized and cache is valid
    if (!forceRefresh && 
        currentState.isInitialized && 
        currentState.lastInitialized && 
        (now - currentState.lastInitialized) < currentState.cacheValidDuration) {
      return true;
    }
    try {
      update(state => ({
        ...state,
        isLoading: true,
        error: null
      }));

      // Get platform info from Tauri backend
      let platformInfo: any = null;
      try {
        platformInfo = await invoke('get_platform_info');
      } catch (error) {
        // Platform detection failed, continue
      }

      const isIOS = platformInfo?.os === 'ios';
      const isAndroid = platformInfo?.os === 'android';
      const isMobile = isIOS || isAndroid;

      // Block only desktop macOS, allow iOS and Android
      if (await isDesktopMacOS()) {
        const macErrorMsg = 'IAP not available on desktop macOS due to platform limitations. Use iOS or Android for in-app purchases.';
        update(state => ({
          ...state,
          isInitialized: false,
          canMakePayments: false,
          isLoading: false,
          error: macErrorMsg,
          pluginAvailable: false
        }));
        return false;
      }

      // Check if IAP functions are available
      if (typeof initialize !== 'function') {
        const pluginErrorMsg = 'IAP plugin functions not available. Plugin may not be loaded or not supported on this platform.';
        update(state => ({
          ...state,
          isInitialized: false,
          canMakePayments: false,
          isLoading: false,
          error: pluginErrorMsg,
          pluginAvailable: false
        }));
        return false;
      }

      // Proceed if we're on iOS/Android or if platform detection failed (safer)
      if (!isMobile && platformInfo) {
        const unsupportedMsg = `IAP not supported on ${platformInfo?.os} platform. Use iOS or Android for in-app purchases.`;
        update(state => ({
          ...state,
          isInitialized: false,
          canMakePayments: false,
          isLoading: false,
          error: unsupportedMsg,
          pluginAvailable: false
        }));
        return false;
      }

      // Initialize IAP plugin
      const result = await initialize();

      // Mark as successfully initialized with timestamp
      update(state => ({
        ...state,
        isInitialized: true,
        canMakePayments: true,
        isLoading: false,
        error: null,
        pluginAvailable: true,
        lastInitialized: now
      }));

      return true;

    } catch (error) {
      const errorMsg = `IAP initialization failed: ${error}`;
      update(state => ({
        ...state,
        error: errorMsg,
        isInitialized: false,
        canMakePayments: false,
        isLoading: false,
        pluginAvailable: false
      }));
      return false;
    }
  }

  async function queryProducts(productIds: string[], productType?: 'inapp' | 'subs'): Promise<void> {
    try {
      // Check if plugin is available and initialized
      if (!checkPluginAvailability('Get products')) {
        throw new Error('IAP plugin not available or not initialized');
      }

      // Get current state to check if initialized
      const currentState = get(store);
      if (!currentState.isInitialized) {
        throw new Error('IAP not initialized');
      }

      // Force the correct product type for consumables
      let finalProductType = productType;
      if (!finalProductType) {
        // Auto-detect based on product ID
        const hasConsumables = productIds.some(id => iapProductIds.consumables.includes(id));
        const hasSubscriptions = productIds.some(id => iapProductIds.subscriptions.includes(id));

        if (hasConsumables && !hasSubscriptions) {
          finalProductType = 'inapp';
        } else if (hasSubscriptions && !hasConsumables) {
          finalProductType = 'subs';
        }
      }

      let response: any = null;
      let lastError: any = null;

      // Primary approach: Use the determined product type
      if (finalProductType) {
        try {
          response = await getProducts(productIds, finalProductType);

          // Validate response has products
          if (!response || (!response.products && !Array.isArray(response))) {
            throw new Error('Empty or invalid response from getProducts');
          }
        } catch (error) {
          lastError = error;
        }
      }

      // Fallback: Try without product type
      if (!response) {
        try {
          response = await getProducts(productIds);
        } catch (error) {
          lastError = error;
        }
      }

      // Individual queries as last resort
      if (!response && productIds.length > 1) {
        const individualProducts: Product[] = [];

        for (const productId of productIds) {
          try {
            const isConsumable = iapProductIds.consumables.includes(productId);
            const individualType = isConsumable ? 'inapp' : 'subs';

            const individualResponse = await getProducts([productId], individualType);

            // Extract products from response
            let products: Product[] = [];
            if (Array.isArray(individualResponse)) {
              products = individualResponse;
            } else if (individualResponse && Array.isArray(individualResponse.products)) {
              products = individualResponse.products;
            } else if (individualResponse && individualResponse.products) {
              products = [individualResponse.products as unknown as Product];
            }

            individualProducts.push(...products);
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            // Individual query failed, continue with others
          }
        }

        if (individualProducts.length > 0) {
          response = { products: individualProducts };
        }
      }

      if (!response) {
        throw lastError || new Error(`Failed to query products: ${productIds.join(', ')}`);
      }

      // Extract products from response
      let allProducts: Product[] = [];
      if (Array.isArray(response)) {
        allProducts = response as Product[];
      } else if (response && Array.isArray(response.products)) {
        allProducts = response.products as Product[];
      } else if (response && response.products && !Array.isArray(response.products)) {
        allProducts = [response.products as Product];
      }

      if (allProducts.length === 0) {
        throw new Error(`No products returned for: ${productIds.join(', ')}`);
      }

      // Update store with new products
      update(state => ({
        ...state,
        products: [...state.products.filter(p => !productIds.includes(p.productId)), ...allProducts],
        error: null // Clear any previous errors
      }));

    } catch (error) {
      const errorMsg = `Failed to query products [${productIds.join(', ')}]: ${error}`;
      update(state => ({
        ...state,
        error: errorMsg
      }));
      throw error; // Re-throw so caller knows it failed
    }
  }


  async function purchaseProduct(productId: string, productType?: 'inapp' | 'subs', offerToken?: string): Promise<void> {
    try {
      // Check if plugin is available first
      if (!checkPluginAvailability('Purchase')) {
        return;
      }

      // Check if we're initialized
      const purchaseState = get(store);
      if (!purchaseState.isInitialized) {
        return;
      }

      // Block only desktop macOS
      if (await isDesktopMacOS()) {
        return;
      }

      // Auto-detect product type if not provided
      let finalProductType = productType;
      if (!finalProductType) {
        if (iapProductIds.subscriptions.includes(productId)) {
          finalProductType = 'subs';
        } else if (iapProductIds.consumables.includes(productId)) {
          finalProductType = 'inapp';
        } else {
          finalProductType = 'inapp'; // Default to inapp
        }
      }

      // Verify product exists before purchase
      const verifyState = get(store);
      const productExists = verifyState.products.some(p => p.productId === productId);
      if (!productExists) {
        const errorMsg = `Product ${productId} not found in loaded products. Available: ${verifyState.products.map(p => p.productId).join(', ')}`;
        update(state => ({
          ...state,
          error: errorMsg
        }));
        return;
      }

      // Use the IAP API to initiate purchase
      const purchaseResponse = await purchase(productId, finalProductType, offerToken);

      // Handle immediate purchase response (iOS may return completed purchase data)
      if (purchaseResponse) {
        const purchaseData = purchaseResponse as any;

        // Check if this is a completed purchase response
        if (purchaseData.purchaseState !== undefined) {
          // This is a completed purchase - process it immediately
          const transaction: Transaction = {
            transactionId: purchaseData.purchaseToken || purchaseData.orderId || `${productId}_${Date.now()}`,
            productId: purchaseData.productId || productId,
            status: purchaseData.purchaseState === 0 ? TransactionStatus.purchased : TransactionStatus.failed,
            purchaseTime: purchaseData.purchaseTime || Date.now(),
            isAutoRenewing: purchaseData.isAutoRenewing || false,
            error: undefined
          };

          // Create purchase record
          const purchaseRecord: Purchase = {
            orderId: purchaseData.orderId || `order_${Date.now()}`,
            packageName: purchaseData.packageName || 'com.testing101.app',
            productId: productId,
            purchaseTime: purchaseData.purchaseTime || Date.now(),
            purchaseToken: purchaseData.purchaseToken || `token_${Date.now()}`,
            purchaseState: purchaseData.purchaseState,
            isAutoRenewing: purchaseData.isAutoRenewing || false,
            isAcknowledged: purchaseData.isAcknowledged || true,
            originalJson: JSON.stringify(purchaseData),
            signature: purchaseData.signature
          };

          update(state => {
            const newPurchases = [...state.purchases.filter(p => p.purchaseToken !== purchaseRecord.purchaseToken), purchaseRecord];
            const newTransactions = [...state.transactions.filter(t => t.transactionId !== transaction.transactionId), transaction];

            // Update active subscriptions if this is a subscription
            let newActiveSubscriptions = [...state.activeSubscriptions];
            if (finalProductType === 'subs' && purchaseData.purchaseState === 0) {
              const subscriptionPurchase = {
                ...purchaseRecord,
                subscriptionStatus: 'active' as const,
                renewalDate: purchaseData.expiryTime || (Date.now() + (30 * 24 * 60 * 60 * 1000)),
                expiryTime: purchaseData.expiryTime || (Date.now() + (30 * 24 * 60 * 60 * 1000))
              };

              // Remove any existing subscription for this product
              newActiveSubscriptions = newActiveSubscriptions.filter(sub => sub.productId !== productId);
              newActiveSubscriptions.push(subscriptionPurchase);
            }

            return {
              ...state,
              purchases: newPurchases,
              transactions: newTransactions,
              activeSubscriptions: newActiveSubscriptions
            };
          });

          // Acknowledge purchase if needed
          if (purchaseData.purchaseState === 0 && purchaseData.purchaseToken) {
            try {
              await acknowledgePurchase(purchaseData.purchaseToken);
            } catch (ackError) {
              console.error('Acknowledgment failed:', ackError);
            }
          }
        }
      }
      
    } catch (error) {
      const errorMsg = `Error purchasing product: ${error}`;
      update(state => ({
        ...state,
        error: errorMsg
      }));
      throw error;
    }
  }

  async function restoreUserPurchases(productType: 'inapp' | 'subs' = 'subs', forceRefresh = false): Promise<void> {
    try {
      // Check if plugin is available first
      if (!checkPluginAvailability('Restore purchases')) {
        return;
      }

      // Check if we're initialized
      const currentState = get(store);
      if (!currentState.isInitialized) {
        return;
      }

      // Block only desktop macOS
      if (await isDesktopMacOS()) {
        return;
      }

      // Use the IAP API to restore purchases - Swift returns {"purchases": array}
      const response = await restorePurchases(productType);

      const allPurchases = response?.purchases || response || [];

      // Create transactions for restored purchases
      const restoredTransactions: Transaction[] = allPurchases.map((p: any) => ({
        transactionId: p.purchaseToken || p.orderId || 'unknown',
        productId: p.productId,
        status: TransactionStatus.restored,
        purchaseTime: p.purchaseTime || Date.now(),
        isAutoRenewing: p.isAutoRenewing || false,
        error: undefined
      }));

      update(state => {
        // Filter out duplicates
        const newPurchases = allPurchases.filter((p: any) =>
          !state.purchases.some((existing: any) => existing.purchaseToken === p.purchaseToken)
        );

        const newTransactions = restoredTransactions.filter((t: any) =>
          !state.transactions.some((existing: any) => existing.transactionId === t.transactionId)
        );

        // Update active subscriptions from restored purchases
        let newActiveSubscriptions = [...state.activeSubscriptions];
        const restoredSubscriptions = newPurchases.filter((p: any) =>
          iapProductIds.subscriptions.includes(p.productId) && p.purchaseState === 0
        );

        restoredSubscriptions.forEach((sub: any) => {
          const subscriptionPurchase = {
            ...sub,
            subscriptionStatus: sub.isAutoRenewing ? 'active' as const : 'expired' as const,
            renewalDate: sub.expiryTime || (Date.now() + (30 * 24 * 60 * 60 * 1000)),
            expiryTime: sub.expiryTime || (Date.now() + (30 * 24 * 60 * 60 * 1000))
          };

          // Remove existing subscription for this product
          newActiveSubscriptions = newActiveSubscriptions.filter((existing: any) => existing.productId !== sub.productId);
          newActiveSubscriptions.push(subscriptionPurchase);
        });

        return {
          ...state,
          purchases: [...state.purchases, ...newPurchases],
          transactions: [...state.transactions, ...newTransactions],
          activeSubscriptions: newActiveSubscriptions
        };
      });
    } catch (error) {
      const errorMsg = `Error restoring purchases: ${error}`;
      update(state => ({
        ...state,
        error: errorMsg
      }));
    }
  }

  function clearError(): void {
    update(state => ({
      ...state,
      error: null
    }));
  }

  function clearLogs(): void {
    update(state => ({
      ...state,
      logs: []
    }));
  }

  async function openSubscriptionSettings(productId: string): Promise<void> {
    try {
      // Check if plugin is available first
      if (!checkPluginAvailability('Open subscription settings')) {
        return;
      }

      // Check if we're initialized
      const currentState = get(store);
      if (!currentState.isInitialized) {
        return;
      }

      // Block only desktop macOS
      if (await isDesktopMacOS()) {
        return;
      }

      // Find the active subscription
      const activeSubscription = currentState.activeSubscriptions.find(sub => sub.productId === productId);
      if (!activeSubscription) {
        throw new Error(`No active subscription found for product: ${productId}`);
      }

      // Try to open iOS Settings directly to subscription management
      // This uses the iOS Settings URL scheme
      try {
        // Attempt to open Settings app directly to subscriptions
        const settingsUrl = 'App-prefs:APPLE_ID&path=SUBSCRIPTIONS';
        await invoke('open_url', { url: settingsUrl });
      } catch (urlError) {
        throw new Error('Please go to iOS Settings > Apple ID > Subscriptions to cancel your subscription');
      }

    } catch (error) {
      const errorMsg = `Error opening subscription settings: ${error}`;
      update(state => ({
        ...state,
        error: errorMsg
      }));
      throw error;
    }
  }

  function getSubscriptionStatus(productId: string): Purchase | null {
    const currentState = get(store);
    return currentState.activeSubscriptions.find(sub => sub.productId === productId) || null;
  }

  function updateSubscriptionStatus(): void {
    update(state => {
      const now = Date.now();
      const updatedSubscriptions = state.activeSubscriptions.map(sub => {
        // Check if subscription has expired - convert expiryTime from seconds to milliseconds if needed
        const expiryTimeMs = sub.expiryTime ? (sub.expiryTime > 1000000000000 ? sub.expiryTime : sub.expiryTime * 1000) : null;
        
        if (expiryTimeMs && expiryTimeMs < now && sub.subscriptionStatus === 'active') {
          return { ...sub, subscriptionStatus: 'expired' as const };
        }
        return sub;
      });

      return {
        ...state,
        activeSubscriptions: updatedSubscriptions
      };
    });
  }

  let purchaseListener: (() => void) | null = null;

  function setupPurchaseListener(): void {
    if (typeof onPurchaseUpdated === 'function' && !purchaseListener) {
      purchaseListener = onPurchaseUpdated((purchase: any) => {        
        const transaction: Transaction = {
          transactionId: purchase.purchaseToken || purchase.orderId || 'unknown',
          productId: purchase.productId,
          status: purchase.purchaseState === 0 ? TransactionStatus.purchased : TransactionStatus.failed,
          purchaseTime: purchase.purchaseTime || Date.now(),
          isAutoRenewing: purchase.isAutoRenewing || false,
          error: undefined
        };

        update(state => {
          const newPurchases = [...state.purchases.filter(p => p.purchaseToken !== purchase.purchaseToken), purchase];
          const newTransactions = [...state.transactions.filter(t => t.transactionId !== transaction.transactionId), transaction];

          // Update active subscriptions if this is a subscription update
          let newActiveSubscriptions = [...state.activeSubscriptions];
          if (iapProductIds.subscriptions.includes(purchase.productId)) {
            const subscriptionPurchase = {
              ...purchase,
              subscriptionStatus: purchase.purchaseState === 0 ? 'active' as const : 'expired' as const,
              renewalDate: purchase.expiryTime || (Date.now() + (30 * 24 * 60 * 60 * 1000)),
              expiryTime: purchase.expiryTime || (Date.now() + (30 * 24 * 60 * 60 * 1000))
            };

            // Remove existing subscription for this product
            newActiveSubscriptions = newActiveSubscriptions.filter(sub => sub.productId !== purchase.productId);
            if (purchase.purchaseState === 0) {
              newActiveSubscriptions.push(subscriptionPurchase);
            }
          }

          return {
            ...state,
            purchases: newPurchases,
            transactions: newTransactions,
            activeSubscriptions: newActiveSubscriptions
          };
        });
      });
    }
  }

  function cleanupPurchaseListener(): void {
    if (purchaseListener) {
      purchaseListener();
      purchaseListener = null;
    }
  }

  return {
    subscribe,
    initialize: initializeIAP,
    queryProducts,
    purchaseProduct,
    restoreUserPurchases,
    restorePurchases: restoreUserPurchases, // Alias for backward compatibility
    openSubscriptionSettings,
    getSubscriptionStatus,
    updateSubscriptionStatus,
    clearError,
    setupPurchaseListener,
    cleanupPurchaseListener
  };
}

// Create and export the IAP store instance
export const iapStore = createIAPStore();

// Derived stores for common use cases
export const iapReady = derived(
  iapStore,
  ($iap: IAPState) => $iap.isInitialized && $iap.canMakePayments && !$iap.isLoading
);

// Product configuration matching StoreKit setup
export const iapProductConfig = {
  consumables: [
    { id: 'tokens_100', tokens: '100', price: '$1.49', emoji: '🪙' },
    { id: 'tokens_500', tokens: '500', price: '$7.49', emoji: '💰' },
    { id: 'tokens_1000', tokens: '1,000', price: '$14.99', emoji: '💎' },
    { id: 'tokens_5000', tokens: '5,000', price: '$30.99', emoji: '🏆' },
    { id: 'tokens_25000', tokens: '25,000', price: '$62.99', emoji: '👑' },
    { id: 'tokens_100000', tokens: '100,000', price: '$159.99', emoji: '🌟' }
  ],
  nonConsumables: [] as Array<{ id: string }>, // No non-consumables in current StoreKit config
  subscriptions: [
    { id: 'monthly_subscription', name: 'Monthly Premium', price: '$10.00', period: '/month', emoji: '📅' },
    { id: 'yearly_subscription', name: 'Yearly Premium', price: '$100.00', period: '/year', emoji: '🗓️' }
  ]
};

// Legacy export for backward compatibility
export const iapProductIds = {
  consumables: iapProductConfig.consumables.map(p => p.id),
  nonConsumables: iapProductConfig.nonConsumables.map(p => p.id),
  subscriptions: iapProductConfig.subscriptions.map(p => p.id)
};

export const iapProducts = derived(
  iapStore,
  ($iap: IAPState) => $iap.products
);

export const iapPurchases = derived(
  iapStore,
  ($iap: IAPState) => $iap.purchases
);

export const activeSubscriptions = derived(
  iapStore,
  ($iap: IAPState) => $iap.activeSubscriptions
);

export const hasActiveSubscription = derived(
  iapStore,
  ($iap: IAPState) => $iap.activeSubscriptions.some(sub => sub.subscriptionStatus === 'active')
);

export const allProductIds = [
  ...iapProductIds.consumables,
  ...iapProductIds.nonConsumables,
  ...iapProductIds.subscriptions
];

// Convenience functions for querying specific product types
export async function queryConsumableProducts() {
  // iOS StoreKit treats consumables differently - try without product type first
  return iapStore.queryProducts(iapProductIds.consumables);
}

export async function querySubscriptionProducts() {
  return iapStore.queryProducts(iapProductIds.subscriptions, 'subs');
}

export async function queryAllProducts() {
  // Query consumables first (without type parameter)
  await queryConsumableProducts();
  // Then query subscriptions with 'subs' type
  await querySubscriptionProducts();
}
