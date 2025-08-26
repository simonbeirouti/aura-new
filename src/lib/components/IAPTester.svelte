<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { iapStore, iapProductConfig, activeSubscriptions, hasActiveSubscription } from "$lib/stores/iapStore";
  import { Button } from "$lib/components/ui/button";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { toast } from "svelte-sonner";

  // Subscribe to store state
  $: state = $iapStore;

  // Loading states for individual actions
  let purchasingProduct = "";
  let statusUpdateInterval: NodeJS.Timeout | null = null;

  // Use product configuration from store
  $: tokenPackages = iapProductConfig.consumables;
  $: subscriptions = iapProductConfig.subscriptions;

  // Helper to get product display info
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
    const tokenData = iapProductConfig.consumables.find(p => p.id === productId);
    const subData = iapProductConfig.subscriptions.find(p => p.id === productId);
    return {
      title: tokenData?.tokens || subData?.name || productId,
      price: tokenData?.price || subData?.price || "Unknown",
      currency: "USD",
    };
  }

  async function handlePurchase(
    productId: string,
    productType: "inapp" | "subs" = "inapp",
  ) {
    if (purchasingProduct) return;
    purchasingProduct = productId;

    const initialPurchaseCount = $iapStore.purchases.length;
    const initialTransactionCount = $iapStore.transactions.length;

    try {
      await iapStore.purchaseProduct(productId, productType);

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
          toast.success(
            `✅ ${productType === "subs" ? "Subscription" : "Purchase"} completed successfully!`,
          );
        } else {
          toast.error(
            `❌ ${productType === "subs" ? "Subscription" : "Purchase"} failed or was cancelled`,
          );
        }
      } else {
        // No purchase record created - likely cancelled or failed
        toast.error(
          `❌ ${productType === "subs" ? "Subscription" : "Purchase"} was cancelled or failed`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Purchase failed";
      toast.error(
        `❌ ${productType === "subs" ? "Subscription" : "Purchase"} failed: ${errorMessage}`,
      );
    } finally {
      purchasingProduct = "";
    }
  }


  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getSubscriptionStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (status) {
      case 'active': return 'default';
      case 'cancelled': return 'secondary';
      case 'expired': return 'destructive';
      case 'pending': return 'outline';
      default: return 'secondary';
    }
  }

  function getDaysUntilRenewal(renewalDate: number): number {
    const now = Date.now();
    const diffMs = renewalDate - now;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  onMount(() => {
    // Auto-initialize IAP
    (async () => {
      const initialized = await iapStore.initialize();

      if (initialized) {
        iapStore.setupPurchaseListener();
        await iapStore.restorePurchases("inapp");
        await iapStore.restorePurchases("subs");
      }
    })();

    // Set up periodic subscription status updates
    statusUpdateInterval = setInterval(() => {
      iapStore.updateSubscriptionStatus();
    }, 60000); // Update every minute
  });

  onDestroy(() => {
    iapStore.cleanupPurchaseListener();
    if (statusUpdateInterval) {
      clearInterval(statusUpdateInterval);
    }
  });
</script>

<div class="w-full max-w-6xl mx-auto space-y-6">
  <div>
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {#each tokenPackages as pkg}
        {@const productInfo = getProductInfo(pkg.id)}
        <Card class="text-center">
          <CardContent class="p-4">
            <div class="text-2xl mb-2">{pkg.emoji}</div>
            <div class="font-semibold text-sm">{productInfo.title} Tokens</div>
            <div class="text-xs text-muted-foreground mb-1">
              {productInfo.price}
            </div>
            <div class="text-xs text-gray-500 mb-3">{productInfo.currency}</div>
            <Button
              size="sm"
              class="w-full text-xs"
              onclick={() => handlePurchase(pkg.id, "inapp")}
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
  </div>

  <!-- Subscriptions -->
  <div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each subscriptions as sub}
        {@const productInfo = getProductInfo(sub.id)}
        <Card>
          <CardContent class="p-4 text-center">
            <div class="text-3xl mb-2">{sub.emoji}</div>
            <div class="font-semibold">{productInfo.title}</div>
            <div class="text-sm text-muted-foreground mb-1">
              {productInfo.price}<span class="text-xs">{sub.period}</span>
            </div>
            <div class="text-xs text-gray-500 mb-3">{productInfo.currency}</div>
            <Button
              class="w-full"
              onclick={() => handlePurchase(sub.id, "subs")}
              disabled={state.isLoading ||
                !state.pluginAvailable ||
                purchasingProduct === sub.id}
            >
              {#if purchasingProduct === sub.id}
                <span class="animate-spin mr-2">⏳</span>
                Subscribing...
              {:else if !state.pluginAvailable}
                Unavailable
              {:else}
                Subscribe
              {/if}
            </Button>
          </CardContent>
        </Card>
      {/each}
    </div>
  </div>

  <!-- Active Subscriptions Management -->
  {#if $activeSubscriptions.length > 0}
    <div class="space-y-4">
      <div class="flex items-center gap-2 mb-4">
        <h3 class="text-lg font-semibold">Active Subscriptions</h3>
        {#if $hasActiveSubscription}
          <Badge variant="default">Live</Badge>
        {/if}
      </div>
      
      <div class="space-y-4">
        {#each $activeSubscriptions as subscription}
          {@const productConfig = iapProductConfig.subscriptions.find(s => s.id === subscription.productId)}
          {@const daysUntilRenewal = subscription.renewalDate ? getDaysUntilRenewal(subscription.renewalDate) : 0}
          <div class="border rounded-lg p-4 bg-card">
            <div class="flex justify-between items-start mb-4">
              <div class="flex items-center gap-3">
                <div class="text-2xl">{productConfig?.emoji || '📱'}</div>
                <div>
                  <div class="font-semibold text-card-foreground">{productConfig?.name || subscription.productId}</div>
                  <div class="text-sm text-muted-foreground">
                    {productConfig?.price || 'Unknown'}{productConfig?.period || ''}
                  </div>
                </div>
              </div>
              <Badge variant="{getSubscriptionStatusVariant(subscription.subscriptionStatus || 'unknown')}">
                {subscription.subscriptionStatus?.toUpperCase() || 'UNKNOWN'}
              </Badge>
            </div>
            
            <div class="grid grid-cols-2 gap-4 text-sm mb-4">
              <div>
                <div class="text-muted-foreground mb-1">Purchase Date</div>
                <div class="font-medium text-card-foreground">
                  {formatDate(subscription.purchaseTime || Date.now())}
                </div>
              </div>
              {#if subscription.renewalDate}
                <div>
                  <div class="text-muted-foreground mb-1">Next Renewal</div>
                  <div class="font-medium text-card-foreground">
                    {formatDate(subscription.renewalDate)}
                    {#if subscription.subscriptionStatus === 'active'}
                      <span class="text-xs text-muted-foreground ml-1">({daysUntilRenewal} days)</span>
                    {/if}
                  </div>
                </div>
              {/if}
              {#if subscription.cancellationDate}
                <div>
                  <div class="text-muted-foreground mb-1">Cancelled Date</div>
                  <div class="font-medium text-orange-600 dark:text-orange-400">
                    {formatDate(subscription.cancellationDate)}
                  </div>
                </div>
              {/if}
              <div>
                <div class="text-muted-foreground mb-1">Auto-Renewing</div>
                <div class="font-medium text-card-foreground">
                  {subscription.isAutoRenewing ? '✅ Yes' : '❌ No'}
                </div>
              </div>
            </div>
            
            {#if subscription.subscriptionStatus === 'expired'}
              <div class="mt-2">
                <Button
                  size="sm"
                  onclick={() => handlePurchase(subscription.productId, "subs")}
                  disabled={purchasingProduct === subscription.productId}
                >
                  {#if purchasingProduct === subscription.productId}
                    <span class="animate-spin mr-2">⏳</span>
                    Resubscribing...
                  {:else}
                    Resubscribe
                  {/if}
                </Button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Recent Purchases -->
  {#if state.purchases.length > 0}
    <Card>
      <CardHeader>
        <CardTitle class="text-sm">Recent Purchases</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-2">
          {#each state.purchases.slice(-5) as purchase}
            <div class="bg-gray-50 p-3 rounded-lg">
              <div class="flex justify-between items-start">
                <div>
                  <div class="font-semibold text-sm">{purchase.productId}</div>
                  <div class="text-xs text-gray-600">
                    Order: {purchase.orderId}
                  </div>
                  <div class="text-xs text-gray-600">
                    {formatDate(purchase.purchaseTime || Date.now())}
                  </div>
                </div>
                <div class="text-right">
                  <div
                    class="text-xs px-2 py-1 rounded {purchase.purchaseState ===
                    0
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'}"
                  >
                    {purchase.purchaseState === 0 ? "Purchased" : "Failed"}
                  </div>
                  {#if purchase.isAutoRenewing}
                    <div class="text-xs text-blue-600 mt-1">Auto-renewing</div>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      </CardContent>
    </Card>
  {/if}
</div>
