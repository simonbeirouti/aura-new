<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import AppLayout from "$lib/components/AppLayout.svelte";
  import { iapStore, iapProductConfig } from "$lib/stores/iapStore";
  import {
    Card,
    CardContent,
    
  } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { toast } from "svelte-sonner";

  let purchasingProduct = "";

  // Subscribe to IAP store - same as IAPTester
  $: state = $iapStore;
  
  // Only show loading if no products are configured at all
  $: loading = tokenPackages.length === 0;
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
    // Initialize IAP in background - don't block UI
    (async () => {
      try {
        // Skip if already initialized with products
        if (state.isInitialized && state.products.length > 0) {
          initialized = true;
          return;
        }

        const result = await iapStore.initialize();
        if (result) {
          iapStore.setupPurchaseListener();
          // Only restore if no purchases exist
          if (state.purchases.length === 0) {
            await iapStore.restorePurchases("inapp");
          }
        }
      } catch (error) {
        console.error('IAP initialization failed:', error);
      } finally {
        initialized = true;
      }
    })();
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

    try {
      // Initiate purchase - the IAP listener will handle completion automatically
      await iapStore.purchaseProduct(productId, "inapp");
      
      // Show immediate feedback and let IAP listener handle the rest
      toast.success("✅ Purchase completed successfully!");
      
    } catch (error) {
      toast.error(`❌ Purchase error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    <div class="flex justify-center items-center py-12">
      <div
        class="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"
      ></div>
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
              disabled={state.isLoading ||
                !state.pluginAvailable ||
                purchasingProduct === pkg.id}
            >
              {#if purchasingProduct === pkg.id}
                <span class="animate-spin mr-1">⏳</span>
                Purchasing...
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
