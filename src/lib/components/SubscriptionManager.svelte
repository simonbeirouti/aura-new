<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { 
    iapStore, 
    iapProductConfig
  } from "$lib/stores/iapStore";
  import { userStore } from "$lib/stores/userStore";
  import { authStore } from "$lib/stores/unifiedAuth";
  import { processSuccessfulPurchase, syncSubscriptionsWithIAP } from "$lib/utils/iapDatabase";
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
          console.log('🔄 SubscriptionManager: Starting initial sync for user:', authState.user.id);
          const syncResult = await syncSubscriptionsWithIAP(authState.user.id);
          console.log('📊 SubscriptionManager: Sync result:', syncResult);
          
          await userStore.refreshSubscriptions(true);
          console.log('✅ SubscriptionManager: User store refreshed');
        } catch (error) {
          console.warn('❌ SubscriptionManager: Initial subscription sync failed:', error);
        }
      } else {
        console.log('💾 SubscriptionManager: Using cached subscription data');
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

        // Check for new purchases that need database processing
        const recentPurchases = state.purchases.filter(purchase => 
          purchase.purchaseState === 0 && // Successful purchase
          purchase.purchaseTime && 
          (Date.now() - purchase.purchaseTime) < 60000 // Within last minute
        );

        for (const purchase of recentPurchases) {
          try {
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
                await processSuccessfulPurchase(
                  authState.user.id,
                  purchase,
                  transaction,
                  "subscription"
                );
                
                // Refresh subscription data
                await userStore.refreshSubscriptions(true);
                console.log('🎉 SubscriptionManager: Subscription purchase processed successfully');
                toast.success("✅ Subscription activated successfully!");
                
              } else if (isConsumable) {
                await processSuccessfulPurchase(
                  authState.user.id,
                  purchase,
                  transaction,
                  "consumable"
                );
                
                // Refresh token balance
                await userStore.refreshTokenBalance(true);
                toast.success("✅ Tokens added successfully!");
              }
            }
          } catch (error) {
            console.error('Failed to process purchase:', error);
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
