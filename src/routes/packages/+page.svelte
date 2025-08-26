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

  // Helper to get product display info - same as IAPTester
  function getProductInfo(productId: string) {
    const storeProduct = state.products.find((p) => p.productId === productId);
    if (storeProduct) {
      return {
        title: storeProduct.title,
        price: storeProduct.formattedPrice,
        currency: storeProduct.priceCurrencyCode,
      };
    }

    // Fallback to config data if product not loaded
    const tokenData = iapProductConfig.consumables.find(
      (p) => p.id === productId,
    );
    return {
      title: tokenData?.tokens || productId,
      price: tokenData?.price || "Unknown",
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

    const initialPurchaseCount = $iapStore.purchases.length;
    const initialTransactionCount = $iapStore.transactions.length;

    try {
      await iapStore.purchaseProduct(productId, "inapp");

      // Wait a moment for purchase to be processed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check if purchase actually completed by looking at store state
      const currentState = $iapStore;
      const purchaseAdded =
        currentState.purchases.length > initialPurchaseCount;
      const transactionAdded =
        currentState.transactions.length > initialTransactionCount;
      const recentTransaction =
        currentState.transactions[currentState.transactions.length - 1];

      if (purchaseAdded || transactionAdded) {
        // Verify the transaction is for this product and successful
        if (
          recentTransaction &&
          recentTransaction.productId === productId &&
          recentTransaction.status === "purchased"
        ) {
          toast.success("✅ Purchase completed successfully!");
        } else {
          toast.error("❌ Purchase failed or was cancelled");
        }
      } else {
        // No purchase record created - likely cancelled or failed
        toast.error("❌ Purchase was cancelled or failed");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Purchase failed";
      toast.error(`❌ Purchase failed: ${errorMessage}`);
    } finally {
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
