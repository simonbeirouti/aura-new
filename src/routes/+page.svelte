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

  onMount(async () => {
    await purchaseManager.loadProducts();
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
      await purchaseManager.purchaseProduct(productId, userId);
      // Refresh user store to update token balance
      await userStore.refreshTokenBalance();
      
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
    </div>

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
