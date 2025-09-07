<script lang="ts">
  import AppLayout from "$lib/components/AppLayout.svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { formattedAvailableTokens, userStore, availableTokens } from "$lib/stores/userStore";
  import {
    purchaseManager,
    products,
    productsLoading,
    productsError,
    purchaseLoading,
  } from "$lib/stores/purchaseStore";
  import { toast } from "svelte-sonner";
  import {
    notificationActions,
    initializeCommonActionTypes,
  } from "$lib/stores/notificationStore";
  import { Button } from "$lib/components/ui/button";
  import { centralizedAuth } from "$lib/stores/unifiedAuth";

  let permissionGranted = false;
  let actionTypesInitialized = false;

  // Reactive: Check if user can afford each product
  $: canAffordProduct = (tokenCost: number) => {
    const canAfford = $availableTokens >= tokenCost;
    console.log(`💰 Can afford product costing ${tokenCost} tokens? ${canAfford} (available: ${$availableTokens})`);
    return canAfford;
  };

  // Reactive: Log token balance changes and refresh when low
  $: if ($availableTokens !== undefined) {
    console.log(`💵 Token balance updated: ${$availableTokens} tokens available`);

    // If balance is very low (≤ 5 tokens), force a refresh to ensure accuracy
    if ($availableTokens <= 5 && $userStore.isInitialized && $userStore.userId) {
      console.log(`⚠️ Low token balance detected (${$availableTokens}), forcing balance refresh`);
      setTimeout(() => {
        userStore.refreshTokenBalance(true);
      }, 500);
    }
  }

  // Reactive: Ensure products are loaded when user becomes authenticated
  $: if ($centralizedAuth.isAuthenticated && $centralizedAuth.isInitialized && $products.length === 0 && !$productsLoading) {
    // Small delay to ensure other initialization is complete
    setTimeout(async () => {
      if ($products.length === 0 && !$productsLoading) {
        try {
          await purchaseManager.loadProducts(false, false);
        } catch (error) {
          // If that fails, try force refresh
          try {
            await purchaseManager.loadProducts(true, false);
          } catch (retryError) {
            // Continue silently on retry error
          }
        }
      }
    }, 1000); // Increased delay to ensure auth init is complete
  }

  onMount(async () => {
    // Ensure products are loaded - fallback if auth initialization didn't load them
    if ($products.length === 0 && !$productsLoading) {
      try {
        await purchaseManager.loadProducts(false, false); // Don't force refresh, don't show toast
      } catch (error) {
        // Try again with force refresh as last resort
        try {
          await purchaseManager.loadProducts(true, false);
        } catch (retryError) {
          // Continue silently on retry error
        }
      }
    }

    // Initialize notification system
    try {
      await notificationActions.initializeListeners();
      permissionGranted = await notificationActions.requestPermission();

      if (permissionGranted) {
        await initializeCommonActionTypes();
        actionTypesInitialized = true;
      }
    } catch (error) {
      // Continue silently on notification initialization error
    }
  });

  async function loadProducts() {
    await purchaseManager.loadProducts(true); // Force refresh
  }

  async function purchaseProduct(productId: string) {
    const userId = $userStore.userId;
    if (!userId) {
      toast.error("Please log in to make a purchase");
      return;
    }

    // Additional check: Prevent multiple clicks on same product
    if ($purchaseLoading[productId]) {
      console.log(`Purchase already in progress for ${productId}, ignoring click`);
      return;
    }

    // Check token balance before attempting purchase
    const product = purchaseManager.getProduct(productId);
    if (product && !canAffordProduct(product.token_cost)) {
      console.log(`❌ UI check failed: Cannot afford ${productId} (cost: ${product.token_cost}, available: ${$availableTokens})`);
      toast.error("You don't have enough tokens. Redirecting to purchase more...");
      setTimeout(() => {
        goto('/packages');
      }, 1500);
      return;
    }

    try {
      console.log(`🛒 Starting purchase flow for ${productId} (available tokens: ${$availableTokens})`);

      await purchaseManager.purchaseProduct(productId, userId);

      console.log(`✅ Purchase flow completed for ${productId}`);

      // Show success toast
      const product = purchaseManager.getProduct(productId);
      toast.success(`Successfully purchased ${product?.name || "product"}!`);

      // Immediately refresh balance from database to ensure UI reflects purchase
      // IAP listener will also update, but this ensures immediate feedback
      console.log(`🔄 Refreshing balance after successful purchase for ${productId}`);
      if (typeof window !== 'undefined' && (window as any).logPlatformEvent) {
        (window as any).logPlatformEvent('info', `Refreshing balance after purchase for ${productId}`, {
          productId,
          action: 'balance_refresh_after_purchase'
        });
      }
      try {
        await userStore.refreshTokenBalance(true);
        console.log(`✅ Balance refreshed after purchase for ${productId}`);
        if (typeof window !== 'undefined' && (window as any).logPlatformEvent) {
          (window as any).logPlatformEvent('info', `Balance successfully refreshed after purchase for ${productId}`, {
            productId,
            action: 'balance_refresh_success'
          });
        }
      } catch (balanceError) {
        console.warn(`⚠️ Failed to refresh balance after purchase:`, balanceError);
        if (typeof window !== 'undefined' && (window as any).logPlatformEvent) {
          (window as any).logPlatformEvent('error', `Failed to refresh balance after purchase for ${productId}`, {
            productId,
            error: balanceError instanceof Error ? balanceError.message : String(balanceError),
            action: 'balance_refresh_failed'
          });
        }
        // Don't fail the purchase if balance refresh fails - IAP listener might still work
      }

    } catch (err) {
      // Check if this is a "purchase already in progress" error
      const errorMessage = err instanceof Error ? err.message : "Purchase failed";

      if (errorMessage === "Purchase already in progress") {
        console.log(`⚠️ Purchase already in progress for ${productId}`);
        return; // Don't show error toast for this
      }

      // Handle insufficient tokens error specifically
      if (errorMessage === "INSUFFICIENT_TOKENS") {
        console.log(`💰 Insufficient tokens detected for ${productId}, redirecting to packages`);
        toast.error("You don't have enough tokens. Redirecting to purchase more...");

        // Small delay to allow toast to show, then redirect
        setTimeout(() => {
          goto('/packages');
        }, 1500);
        return;
      }

      console.error(`❌ Purchase failed for ${productId}:`, errorMessage);
      toast.error(errorMessage);
    }
  }

  async function sendMessageNotification() {
    try {
      await notificationActions.sendActionNotification(
        "New Message",
        "You have a new message from John Doe. Tap to reply or mark as read.",
        "messages",
      );
    } catch (error) {
      toast.error("Failed to send message notification");
    }
  }

  async function sendReminderNotification() {
    try {
      await notificationActions.sendActionNotification(
        "Task Reminder",
        "Don't forget to complete your daily standup meeting.",
        "reminders",
      );
    } catch (error) {
      toast.error("Failed to send reminder notification");
    }
  }

  async function requestNotificationPermission() {
    try {
      permissionGranted = await notificationActions.requestPermission();
      if (permissionGranted) {
        await initializeCommonActionTypes();
        actionTypesInitialized = true;
      } else {
        toast.error("Notification permission denied");
      }
    } catch (error) {
      toast.error("Failed to request permission");
    }
  }

  async function sendInstantNotification() {
    try {
      await notificationActions.sendNotification(
        "Instant Notification",
        "This notification appeared immediately!",
      );
    } catch (error) {
      toast.error("Failed to send notification");
    }
  }
</script>

<AppLayout>
  <div class="container mx-auto">
    <!-- Header Section -->
    <div class="text-center mb-8">

      <!-- Token Balance Display -->
      {#if $userStore.isInitialized}
        <div
          class="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full"
        >
          <span class="text-2xl">🪙</span>
          <span class="font-semibold"
            >{$formattedAvailableTokens} tokens available</span
          >
        </div>
      {/if}

      <!-- Notification Test Section -->
      <div class="mt-6 p-6 bg-card border rounded-lg max-w-2xl mx-auto">
        {#if !permissionGranted}
          <div class="text-center mb-4">
            <p class="text-sm text-muted-foreground mb-3">
              Permission required to send notifications
            </p>
            <Button onclick={requestNotificationPermission}>
              Request Permission
            </Button>
          </div>
        {:else}
          <div class="grid grid-cols-3 gap-3">
            <!-- Basic Notifications -->
            <Button onclick={sendInstantNotification} class="w-full">
              Instant
            </Button>

            <Button
              variant="secondary"
              onclick={sendMessageNotification}
              disabled={!actionTypesInitialized}
              class="w-full"
            >
              Reply
            </Button>

            <Button
              variant="secondary"
              onclick={sendReminderNotification}
              disabled={!actionTypesInitialized}
              class="w-full"
            >
              Task
            </Button>
          </div>
        {/if}
      </div>

    </div>

    <!-- Products Section -->
    <div>
      <h2 class="text-2xl font-bold text-center mb-8">Available Products</h2>

      <!-- Loading State -->
      {#if $productsLoading}
        <div class="text-center py-12">
          <div
            class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"
          ></div>
          <p class="text-muted-foreground">
            {#if $products.length === 0}
              Loading products from server...
            {:else}
              Refreshing products...
            {/if}
          </p>
          <p class="text-xs text-muted-foreground mt-2">
            This may take a moment on first load
          </p>
        </div>
      {/if}

      <!-- Error State -->
      {#if $productsError}
        <div class="text-center py-12">
          <div
            class="bg-destructive/10 text-destructive p-4 rounded-lg max-w-md mx-auto"
          >
            <p class="font-semibold mb-2">Failed to load products</p>
            <p class="text-sm">{$productsError}</p>
            <Button onclick={loadProducts}>Try Again</Button>
          </div>
        </div>
      {/if}

      <!-- Products Grid -->
      {#if !$productsLoading && !$productsError && $products.length > 0}
        <div class="mb-4 text-center">
          <span class="text-sm text-muted-foreground">
            ✅ {$products.length} products loaded
          </span>
        </div>
      {/if}

      <!-- Products Grid (only show if loaded) -->
      {#if !$productsLoading && !$productsError && $products.length > 0}
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {#each $products as product}
            <div
              class="bg-card border rounded-lg p-4 md:p-6 hover:shadow-lg transition-shadow text-center"
            >
              <!-- Product Header -->
              <div class="mb-3">
                <h3 class="font-semibold text-base md:text-lg mb-2">
                  {product.name}
                </h3>
              </div>

              <!-- Product Description -->
              <p
                class="text-muted-foreground text-xs md:text-sm mb-4 md:mb-6 leading-relaxed"
              >
                {product.description}
              </p>

              <!-- Purchase Button -->
              <div class="space-y-2">
                <Button
                  onclick={() => purchaseProduct(product.id)}
                  disabled={$purchaseLoading[product.id] ||
                    !canAffordProduct(product.token_cost)}
                  class="w-full"
                >
                  {#if $purchaseLoading[product.id]}
                    <div
                      class="animate-spin rounded-full h-4 w-4 border-b-2 border-current"
                    ></div>
                    <span>Purchasing...</span>
                  {:else if !canAffordProduct(product.token_cost)}
                    <span>Insufficient Tokens</span>
                  {:else}
                    <span>🪙</span>
                    <span>{product.token_cost} tokens</span>
                  {/if}
                </Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Empty State -->
      {#if !$productsLoading && !$productsError && $products.length === 0}
        <div class="text-center py-12">
          <div class="text-6xl mb-4">
            {#if $centralizedAuth.isAuthenticated}
              🔄
            {:else}
              🔒
            {/if}
          </div>
          <h3 class="text-xl font-semibold mb-2">
            {#if $centralizedAuth.isAuthenticated}
              Loading Products...
            {:else}
              Authentication Required
            {/if}
          </h3>
          <p class="text-muted-foreground mb-6">
            {#if $centralizedAuth.isAuthenticated}
              Products are being loaded. This may take a moment on first visit.
            {:else}
              Please sign in to view available products.
            {/if}
          </p>
          {#if $centralizedAuth.isAuthenticated}
            <Button onclick={loadProducts} disabled={$productsLoading}>
              {#if $productsLoading}
                <span class="loading loading-spinner loading-sm mr-2"></span>
                Loading...
              {:else}
                Retry Loading
              {/if}
            </Button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</AppLayout>
