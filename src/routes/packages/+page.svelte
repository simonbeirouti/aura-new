<script lang="ts">
    import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { goto } from "$app/navigation";
  import AppLayout from "$lib/components/AppLayout.svelte";
  import { iapStore, iapProductConfig } from "$lib/stores/iapStore";
  import { sessionStore } from "$lib/stores/sessionStore";
  import {
    Card,
    CardContent,

  } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { toast } from "svelte-sonner";

  let purchasingProduct = "";
  let isInitializing = true;
  let retryCount = 0;

  // Subscribe to IAP store - same as IAPTester
  $: state = $iapStore;

  // Subscribe to session store
  $: sessionState = $sessionStore;

  // Initialize IAP immediately when component is created
  async function initializeIAPImmediately() {
    try {
      // Check if already initialized and recent (reduce cache time for faster refresh)
      if (state.isInitialized && state.lastInitialized &&
          (Date.now() - state.lastInitialized) < (2 * 60 * 1000)) { // 2 minutes instead of 5
        isInitializing = false;
        return;
      }

      const result = await iapStore.initialize();

      if (result) {
        iapStore.setupPurchaseListener();

        try {
          await iapStore.queryProducts(iapProductConfig.consumables.map(p => p.id), "inapp");

          // Verify products were loaded
          const currentState = get(iapStore);

          // If no products were loaded, try alternative approaches
          if (currentState.products.length === 0) {
            // Try without product type
            try {
              await iapStore.queryProducts(iapProductConfig.consumables.map(p => p.id));
            } catch (retryError) {
              // Continue silently on retry error
            }
          }
        } catch (productError) {
          // Try fallback: load without specifying product type
          try {
            await iapStore.queryProducts(iapProductConfig.consumables.map(p => p.id));
          } catch (fallbackError) {
            // Continue silently on fallback error
          }
        }

        // Only restore if no purchases exist
        if (state.purchases.length === 0) {
          try {
            await iapStore.restorePurchases("inapp");
          } catch (restoreError) {
            // Continue silently on restore error
          }
        }
      }
    } catch (error) {
      // Continue silently on initialization error
    } finally {
      isInitializing = false;
    }
  }

  // Start initialization immediately
  initializeIAPImmediately();

  // Retry function for manual product loading
  async function retryProductLoading() {
    retryCount++;

    try {
      isInitializing = true;
      await iapStore.queryProducts(iapProductConfig.consumables.map(p => p.id), "inapp");

      const currentState = get(iapStore);

      if (currentState.products.length > 0) {
        toast.success("Products loaded successfully!");
      } else {
        toast.error("Still no products loaded. Please check your connection.");
      }
    } catch (error) {
      toast.error("Failed to load products. Please try again.");
    } finally {
      isInitializing = false;
    }
  }
  
  // Show loading until IAP is initialized and products are loaded
  $: loading = isInitializing || (tokenPackages.length === 0 && !isInitializing);

  // Check if products failed to load (for showing retry button)
  $: productsFailedToLoad = !isInitializing && tokenPackages.length === 0 && retryCount === 0;
  let initialized = false;

  // Use product configuration from store - same as IAPTester
  $: tokenPackages = iapProductConfig.consumables;


  // Cache for stable pricing display (prevents flashing)
  let pricingCache: Record<string, {title: string, price: string, currency: string}> = {};
  
  // Helper to get product display info with stable pricing
  function getProductInfo(productId: string) {
    const storeProduct = state.products.find((p) => p.productId === productId);
    const tokenData = iapProductConfig.consumables.find((p) => p.id === productId);
    
    // If we have store product data, cache it and use it
    if (storeProduct && storeProduct.formattedPrice) {
      const productInfo = {
        title: tokenData?.tokens || storeProduct.title || productId,
        price: storeProduct.formattedPrice,
        currency: storeProduct.priceCurrencyCode || "USD",
      };
      
      // Cache this pricing to prevent future flashing
      pricingCache[productId] = productInfo;
      return productInfo;
    }

    // If we have cached pricing from previous load, use it (prevents flashing)
    if (pricingCache[productId]) {
      return pricingCache[productId];
    }

    // Only show config fallback if we have no cached data
    return {
      title: tokenData?.tokens || productId,
      price: tokenData?.price || "Loading...",
      currency: "USD",
    };
  }

  onMount(() => {
    // Initialization already happened immediately, just mark as mounted
    initialized = true;
  });

  onDestroy(() => {
    iapStore.cleanupPurchaseListener();
  });

  function goBack() {
    goto("/");
  }

  async function handlePurchase(productId: string) {
    if (purchasingProduct) return;
    purchasingProduct = productId;

    // Clear any existing toasts first
    toast.dismiss();

    try {
      // Check if user is authenticated
      if (!sessionState?.isAuthenticated || !sessionState?.user?.id) {
        toast.error("Please log in to make purchases");
        return;
      }

      // Check if IAP is available
      if (!state.pluginAvailable) {
        toast.error("IAP not available on this device/platform");
        return;
      }

      // Show processing feedback
      const processingToast = toast.loading("Initiating purchase...");

      // Initiate purchase - this will trigger the platform's purchase flow
      await iapStore.purchaseProduct(productId, "inapp");

      // Dismiss processing toast and show success
      toast.dismiss(processingToast);
      toast.success("Purchase initiated!");

    } catch (error) {
      toast.dismiss();
      toast.error(`Purchase error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      // Reset button state
      purchasingProduct = "";
    }
  }

</script>

<AppLayout
  title="Packages"
  showBackButton={true}
  onBack={goBack}
  maxWidth="max-w-4xl"
>

  {#if loading}
    <div class="flex flex-col justify-center items-center py-12 space-y-4">
      <div
        class="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"
      ></div>
      <div class="text-sm text-muted-foreground text-center">
        {#if isInitializing}
          Initializing purchase system...
        {:else}
          Loading packages...
        {/if}
      </div>
      {#if productsFailedToLoad || (!isInitializing && retryCount > 0 && retryCount < 3)}
        <Button
          size="sm"
          variant="outline"
          onclick={retryProductLoading}
          class="mt-2"
        >
          🔄 Retry Loading ({retryCount}/3)
        </Button>
      {/if}
    </div>
  {:else}
    <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
      {#each tokenPackages as pkg}
        {@const productInfo = getProductInfo(pkg.id)}
        <Card class="text-center">
          <CardContent>
            <div class="text-2xl mb-2">{pkg.emoji}</div>
            <div class="font-semibold text-sm">
              {productInfo.title} Tokens
            </div>
            <div class="text-xs text-muted-foreground mb-2">
              {productInfo.price} {productInfo.currency}
            </div>
            <Button
              size="sm"
              class="w-full text-xs"
              onclick={() => handlePurchase(pkg.id)}
              disabled={isInitializing ||
                state.isLoading ||
                !state.pluginAvailable ||
                purchasingProduct === pkg.id}
            >
              {#if purchasingProduct === pkg.id}
                <span class="animate-spin mr-1">⏳</span>
                Purchasing...
              {:else if isInitializing}
                <span class="animate-spin mr-1">⏳</span>
                Loading...
              {:else if !state.pluginAvailable}
                Unavailable
              {:else}
                Purchase
              {/if}
            </Button>
          </CardContent>
        </Card>
      {/each}
    </div>
  {/if}
</AppLayout>
