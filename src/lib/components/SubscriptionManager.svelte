<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { 
    iapStore, 
    iapProductConfig
  } from "$lib/stores/iapStore";
  import { userStore } from "$lib/stores/userStore";
  import { authStore } from "$lib/stores/unifiedAuth";
  import { processSuccessfulPurchase, syncSubscriptionsWithIAP, checkTransactionExists } from "$lib/utils/iapDatabase";
  import { toast } from "svelte-sonner";

  // Reactive state management
  $: iapState = $iapStore;
  $: userState = $userStore;
  $: authState = $authStore;

  // Cache management for initialization logic
  $: hasCachedSubscriptionData = userState.lastSubscriptionUpdate && 
    (Date.now() - userState.lastSubscriptionUpdate) < userState.cacheValidDuration;

  let initialized = false;
  let purchaseListener: (() => void) | null = null;
  
  // Track processed purchases to prevent duplicate database entries
  const processedPurchases = new Set<string>();

  /**
   * Initialize subscription and token management
   */
  async function initializeSubscriptionManager(): Promise<void> {
    if (!browser || !authState.isAuthenticated || !authState.user?.id) {
      return;
    }

    try {
      // Initialize user store if not already done
      if (!userState.isInitialized) {
        await userStore.initialize(authState.user.id);
      }

      // Initialize IAP store for purchases (non-blocking)
      if (!iapState.isInitialized) {
        iapStore.initialize().then(() => {
          setupPurchaseListener();
        }).catch(error => {
          console.warn('IAP initialization failed:', error);
        });
      } else {
        setupPurchaseListener();
      }

      // Sync subscriptions if cache is stale
      if (!hasCachedSubscriptionData) {
        try {
          await userStore.refreshSubscriptions(true);
        } catch (error) {
          console.warn('❌ SubscriptionManager: Initial subscription sync failed:', error);
        }
      }

      initialized = true;
    } catch (error) {
      console.error('SubscriptionManager initialization failed:', error);
      initialized = true; // Still mark as initialized to prevent loops
    }
  }

  /**
   * Setup purchase event listener for real-time updates
   */
  function setupPurchaseListener(): void {
    if (purchaseListener || !iapState.isInitialized) return;

    try {
      iapStore.setupPurchaseListener();
      
      // Monitor IAP store changes for purchase completion
      const unsubscribe = iapStore.subscribe(async (state) => {
        if (!authState.user?.id) return;

        // Check for purchases that need database processing
        // Process both new purchases (last minute) and restored purchases
        const newPurchases = state.purchases.filter(purchase => {
          const purchaseKey = `${purchase.productId}_${purchase.purchaseToken}`;
          const isRecent = purchase.purchaseTime && (Date.now() - purchase.purchaseTime) < 60000;
          const isRestored = state.lastPurchasesRestore && (Date.now() - state.lastPurchasesRestore) < 30000; // Within 30s of restore
          
          return purchase.purchaseState === 0 && // Successful purchase
                 purchase.purchaseTime && 
                 (isRecent || isRestored) && // Either recent purchase or from recent restore
                 !processedPurchases.has(purchaseKey); // Not already processed
        });

        for (const purchase of newPurchases) {
          const purchaseKey = `${purchase.productId}_${purchase.purchaseToken}`;
          
          try {
            // Mark as being processed to prevent duplicates
            processedPurchases.add(purchaseKey);
            
            // Check if this transaction already exists in database
            const exists = await checkTransactionExists(
              authState.user.id,
              purchase.purchaseToken, // Use purchaseToken as transactionId
              purchase.purchaseToken
            );
            
            if (exists) {
              continue;
            }

            // Find corresponding transaction
            const transaction = state.transactions.find(t => 
              t.productId === purchase.productId && 
              t.status === 'purchased'
            );

            if (transaction) {
              // Determine purchase type
              const isSubscription = iapProductConfig.subscriptions.some(s => s.id === purchase.productId);
              const isConsumable = iapProductConfig.consumables.some(c => c.id === purchase.productId);

              if (isSubscription) {
                // Get store product for localized pricing
                const storeProduct = $iapStore.products.find((p) => p.productId === purchase.productId);
                
                await processSuccessfulPurchase(
                  authState.user.id,
                  purchase,
                  transaction,
                  "subscription",
                  storeProduct
                );
                
                // Refresh subscription data
                await userStore.refreshSubscriptions(true);
                toast.success("✅ Subscription activated successfully!");
                
              } else if (isConsumable) {
                // Get store product for localized pricing
                const storeProduct = $iapStore.products.find((p) => p.productId === purchase.productId);
                
                await processSuccessfulPurchase(
                  authState.user.id,
                  purchase,
                  transaction,
                  "consumable",
                  storeProduct
                );
                
                // Refresh token balance
                await userStore.refreshTokenBalance(true);
                toast.success("✅ Tokens added successfully!");
              }
            }
          } catch (error) {
            console.error('Failed to process purchase:', error);
            // Remove from processed set on error so it can be retried
            processedPurchases.delete(purchaseKey);
          }
        }
      });

      purchaseListener = unsubscribe;
    } catch (error) {
      console.warn('Failed to setup purchase listener:', error);
    }
  }

  /**
   * Handle subscription purchase
   */
  async function purchaseSubscription(productId: string): Promise<boolean> {
    if (!authState.user?.id || !iapState.canMakePayments) {
      toast.error("❌ Unable to make purchases at this time");
      return false;
    }

    try {
      await iapStore.purchaseProduct(productId, "subs");
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Purchase failed';
      toast.error(`❌ Purchase failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Handle token purchase
   */
  async function purchaseTokens(productId: string): Promise<boolean> {
    if (!authState.user?.id || !iapState.canMakePayments) {
      toast.error("❌ Unable to make purchases at this time");
      return false;
    }

    try {
      await iapStore.purchaseProduct(productId, "inapp");
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Purchase failed';
      toast.error(`❌ Token purchase failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Restore purchases
   */
  async function restorePurchases(): Promise<void> {
    if (!iapState.isInitialized) {
      toast.error("❌ Purchase system not ready");
      return;
    }

    try {
      await iapStore.restorePurchases("subs");
      
      if (authState.user?.id) {
        await syncSubscriptionsWithIAP(authState.user.id);
        await userStore.refreshSubscriptions(true);
      }
      
      toast.success("✅ Purchases restored successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Restore failed';
      toast.error(`❌ Restore failed: ${errorMessage}`);
    }
  }

  /**
   * Force refresh subscription data
   */
  async function refreshSubscriptionData(): Promise<void> {
    if (!authState.user?.id) return;

    try {
      await syncSubscriptionsWithIAP(authState.user.id);
      await userStore.refreshSubscriptions(true);
    } catch (error) {
      console.error('Failed to refresh subscription data:', error);
    }
  }

  /**
   * Force refresh token data
   */
  async function refreshTokenData(): Promise<void> {
    await userStore.refreshTokenBalance(true);
  }

  // Initialize when component mounts and auth state is ready
  onMount(() => {
    if (authState.isAuthenticated && authState.user?.id) {
      initializeSubscriptionManager();
    }
  });

  // React to auth state changes
  $: if (authState.isAuthenticated && authState.user?.id && !initialized) {
    initializeSubscriptionManager();
  }

  // Cleanup on destroy
  onDestroy(() => {
    if (purchaseListener) {
      purchaseListener();
      purchaseListener = null;
    }
    
    if (iapState.isInitialized) {
      iapStore.cleanupPurchaseListener();
    }
  });

  // Export functions for external use
  export { 
    purchaseSubscription,
    purchaseTokens,
    restorePurchases,
    refreshSubscriptionData,
    refreshTokenData
  };
</script>

<!-- This component is invisible but manages subscription state globally -->
<div style="display: none;">
  <!-- Subscription Manager Active -->
</div>
