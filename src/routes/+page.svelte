<script lang="ts">
  import AppLayout from "$lib/components/AppLayout.svelte";
  import { onMount } from 'svelte';
  import { userStore } from '$lib/stores/userStore';
  import { formattedAvailableTokens } from '$lib/stores/userStore';
  import { 
    purchaseManager, 
    products, 
    productsLoading, 
    productsError, 
    purchaseLoading 
  } from '$lib/stores/purchaseStore';
  import { toast } from 'svelte-sonner';
  import { 
    notificationActions, 
    initializeCommonActionTypes,
    commonActionTypes 
  } from '$lib/stores/notificationStore';
  import { listen } from '@tauri-apps/api/event';

  let permissionGranted = false;
  let actionTypesInitialized = false;

  onMount(async () => {
    await purchaseManager.loadProducts();
    
    // Initialize notification system
    try {
      await notificationActions.initializeListeners();
      permissionGranted = await notificationActions.requestPermission();
      
      if (permissionGranted) {
        await initializeCommonActionTypes();
        actionTypesInitialized = true;
      }
    } catch (error) {
      console.error('Failed to initialize notifications:', error);
    }
  });

  async function loadProducts() {
    await purchaseManager.loadProducts(true); // Force refresh
  }

  async function purchaseProduct(productId: string) {
    const userId = $userStore.userId;
    if (!userId) {
      toast.error('Please log in to make a purchase');
      return;
    }
    
    try {
      const result = await purchaseManager.purchaseProduct(productId, userId);
      
      // Immediately update token balance without database call
      userStore.updateTokenBalanceAfterPurchase(result.newTokenBalance.tokenCost);
      
      // Show success toast
      const product = purchaseManager.getProduct(productId);
      toast.success(`Successfully purchased ${product?.name || 'product'}!`);
    } catch (err) {
      // Show error toast instead of inline error
      const errorMessage = err instanceof Error ? err.message : 'Purchase failed';
      toast.error(errorMessage);
      console.error('Purchase failed:', err);
    }
  }


  async function sendMessageNotification() {
    try {
      await notificationActions.sendActionNotification(
        "New Message",
        "You have a new message from John Doe. Tap to reply or mark as read.",
        "messages"
      );
      toast.success("Message notification with actions sent");
    } catch (error) {
      toast.error("Failed to send message notification");
      console.error('Message notification error:', error);
    }
  }

  async function sendReminderNotification() {
    try {
      await notificationActions.sendActionNotification(
        "Task Reminder",
        "Don't forget to complete your daily standup meeting.",
        "reminders"
      );
      toast.success("Reminder notification with actions sent");
    } catch (error) {
      toast.error("Failed to send reminder notification");
      console.error('Reminder notification error:', error);
    }
  }

  async function requestNotificationPermission() {
    try {
      permissionGranted = await notificationActions.requestPermission();
      if (permissionGranted) {
        await initializeCommonActionTypes();
        actionTypesInitialized = true;
        toast.success("Notification permission granted!");
      } else {
        toast.error("Notification permission denied");
      }
    } catch (error) {
      toast.error("Failed to request permission");
      console.error('Permission request error:', error);
    }
  }

  async function sendInstantNotification() {
    try {
      await notificationActions.sendNotification(
        "Instant Notification",
        "This notification appeared immediately!"
      );
      toast.success("Instant notification sent");
    } catch (error) {
      toast.error("Failed to send notification");
      console.error('Instant notification error:', error);
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
        <div class="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full">
          <span class="text-2xl">🪙</span>
          <span class="font-semibold">{$formattedAvailableTokens} tokens available</span>
        </div>
      {/if}

      <!-- Notification Test Section -->
      <div class="mt-8 p-6 bg-card border rounded-lg max-w-2xl mx-auto">
        <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
          <span>🔔</span>
          Test Notifications
        </h3>
        
        {#if !permissionGranted}
          <div class="text-center mb-4">
            <p class="text-sm text-muted-foreground mb-3">
              Permission required to send notifications
            </p>
            <button
              onclick={requestNotificationPermission}
              class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Request Permission
            </button>
          </div>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <!-- Basic Notifications -->
            <div class="space-y-3">
              <h4 class="text-sm font-medium text-muted-foreground">Basic Notifications</h4>
              
              <button
                onclick={sendInstantNotification}
                class="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm"
              >
                Send Instant Notification
              </button>
            </div>

            <!-- Action Notifications -->
            <div class="space-y-3">
              <h4 class="text-sm font-medium text-muted-foreground">Interactive Notifications</h4>
              
              <button
                onclick={sendMessageNotification}
                disabled={!actionTypesInitialized}
                class="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors disabled:opacity-50 text-sm"
              >
                Message with Reply
              </button>

              <button
                onclick={sendReminderNotification}
                disabled={!actionTypesInitialized}
                class="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors disabled:opacity-50 text-sm"
              >
                Task Reminder
              </button>
            </div>
          </div>

          {#if actionTypesInitialized}
            <div class="mt-4 p-3 bg-muted/50 rounded-md">
              <p class="text-xs text-muted-foreground mb-2">Registered Action Types:</p>
              <div class="flex flex-wrap gap-2">
                {#each commonActionTypes as actionType}
                  <span class="px-2 py-1 bg-primary/10 text-primary text-xs rounded">
                    {actionType.id} ({actionType.actions.length} actions)
                  </span>
                {/each}
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <!-- Products Section -->
    <div class="mt-12">
      <h2 class="text-2xl font-bold text-center mb-8">Available Products</h2>
    
    <!-- Loading State -->
    {#if $productsLoading}
      <div class="text-center py-12">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
        <p class="text-muted-foreground">Loading products...</p>
      </div>
    {/if}

    <!-- Error State -->
    {#if $productsError}
      <div class="text-center py-12">
        <div class="bg-destructive/10 text-destructive p-4 rounded-lg max-w-md mx-auto">
          <p class="font-semibold mb-2">Failed to load products</p>
          <p class="text-sm">{$productsError}</p>
          <button 
            onclick={loadProducts}
            class="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    {/if}

    <!-- Products Grid -->
    {#if !$productsLoading && !$productsError && $products.length > 0}
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {#each $products as product}
          <div class="bg-card border rounded-lg p-4 md:p-6 hover:shadow-lg transition-shadow text-center">
            <!-- Product Header -->
            <div class="mb-3">
              <h3 class="font-semibold text-base md:text-lg mb-2">{product.name}</h3>
            </div>

            <!-- Product Description -->
            <p class="text-muted-foreground text-xs md:text-sm mb-4 md:mb-6 leading-relaxed">
              {product.description}
            </p>

            <!-- Purchase Button -->
            <div class="space-y-2">
              <button
                onclick={() => purchaseProduct(product.id)}
                disabled={$purchaseLoading[product.id] || !userStore.hasSufficientTokens(product.token_cost)}
                class="w-full px-2 py-2 md:px-4 text-xs md:text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 md:gap-2"
              >
                {#if $purchaseLoading[product.id]}
                  <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                  <span>Purchasing...</span>
                {:else if !userStore.hasSufficientTokens(product.token_cost)}
                  <span>Insufficient Tokens</span>
                {:else}
                  <span>🪙</span>
                  <span>{product.token_cost} tokens</span>
                {/if}
              </button>
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
        <p class="text-muted-foreground mb-6">Check back later for new items!</p>
        <button 
          onclick={loadProducts}
          class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          Refresh
        </button>
      </div>
    {/if}
  </div>
</AppLayout>
