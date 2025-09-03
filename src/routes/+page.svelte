<script lang="ts">
  import AppLayout from "$lib/components/AppLayout.svelte";
  import { onMount } from "svelte";
  import { userStore } from "$lib/stores/userStore";
  import { formattedAvailableTokens } from "$lib/stores/userStore";
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

  let permissionGranted = false;
  let actionTypesInitialized = false;

  onMount(async () => {
    // Products are now loaded during auth initialization
    // No need to load them here again

    // Initialize notification system
    try {
      await notificationActions.initializeListeners();
      permissionGranted = await notificationActions.requestPermission();

      if (permissionGranted) {
        await initializeCommonActionTypes();
        actionTypesInitialized = true;
      }
    } catch (error) {
      console.error("Failed to initialize notifications:", error);
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

    try {
      const result = await purchaseManager.purchaseProduct(productId, userId);

      // Immediately update token balance without database call
      userStore.updateTokenBalanceAfterPurchase(
        result.newTokenBalance.tokenCost,
      );

      // Show success toast
      const product = purchaseManager.getProduct(productId);
      toast.success(`Successfully purchased ${product?.name || "product"}!`);
    } catch (err) {
      // Show error toast instead of inline error
      const errorMessage =
        err instanceof Error ? err.message : "Purchase failed";
      toast.error(errorMessage);
      console.error("Purchase failed:", err);
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
      console.error("Message notification error:", error);
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
      console.error("Reminder notification error:", error);
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
      console.error("Permission request error:", error);
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
      console.error("Instant notification error:", error);
    }
  }
</script>

<AppLayout>
  <div class="container mx-auto">
    <!-- Header Section -->
    <div class="text-center mb-12">
      <h1 class="text-4xl font-bold mb-4">Welcome to Aura Store</h1>
      <p class="text-muted-foreground text-lg mb-6">
        Enhance your experience with premium features and upgrades
      </p>

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
          <p class="text-muted-foreground">Loading products...</p>
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
                    !userStore.hasSufficientTokens(product.token_cost)}
                  class="w-full"
                >
                  {#if $purchaseLoading[product.id]}
                    <div
                      class="animate-spin rounded-full h-4 w-4 border-b-2 border-current"
                    ></div>
                    <span>Purchasing...</span>
                  {:else if !userStore.hasSufficientTokens(product.token_cost)}
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
          <div class="text-6xl mb-4">🛍️</div>
          <h3 class="text-xl font-semibold mb-2">No products available</h3>
          <p class="text-muted-foreground mb-6">
            Check back later for new items!
          </p>
          <Button onclick={loadProducts}>Refresh</Button>
        </div>
      {/if}
    </div>
  </div>
</AppLayout>
