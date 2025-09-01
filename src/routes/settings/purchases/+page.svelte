<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import AppLayout from "$lib/components/AppLayout.svelte";
    import { centralizedAuth } from "$lib/stores/unifiedAuth";
    import { iapStore, iapProductConfig } from "$lib/stores/iapStore";
    import { getUserIAPTransactions, type IAPTransactionRecord } from "$lib/utils/iapDatabase";
    import { Card, CardContent } from "$lib/components/ui/card";
    import { Button } from "$lib/components/ui/button";
    import { CreditCardIcon } from "lucide-svelte";
    import { browser } from '$app/environment';
    import { cacheManager, cacheKeys } from "$lib/stores/cacheManager";
    
    let purchases: IAPTransactionRecord[] = [];
    let loading = true;
    let showLoading = false;
    let error: string | null = null;
    let iapState: any = {};
    let isInitialized = false;
    
    // Pre-computed display data to avoid reactive calculations and flashing
    let cachedTotalValue = "$0.00 USD";
    let cachedPurchaseDisplays: Array<{
        purchase: IAPTransactionRecord;
        name: string;
        price: string;
        currency: string;
        emoji: string;
        formattedDate: string;
    }> = [];
    
    // Load cached data immediately on component initialization
    if (browser) {
        // Use async pattern for auth state
        centralizedAuth.getState().then(authState => {
            if (authState?.user?.id) {
                const cached = cacheManager.get<IAPTransactionRecord[]>(cacheKeys.userPurchases(authState.user.id));
                if (cached && cached.length > 0) {
                    purchases = cached;
                    computeDisplayData(cached);
                    isInitialized = true;
                }
            }
        }).catch(console.warn);
    }
    
    // Show content immediately if we have cached data or after first load
    $: showContent = isInitialized && (purchases.length > 0 || error === null);

    function setCachedPurchases(data: IAPTransactionRecord[], userId: string) {
        if (!browser) return;
        
        try {
            cacheManager.set(cacheKeys.userPurchases(userId), data);
        } catch {
            // Ignore cache errors
        }
    }

    // Pre-compute all display data to avoid reactive calculations and flashing
    function computeDisplayData(purchaseList: IAPTransactionRecord[]) {
        const successfulPurchases = purchaseList.filter((p) => p.purchase_state === 0);
        
        // Compute individual purchase displays
        cachedPurchaseDisplays = purchaseList.map(purchase => {
            const productInfo = getProductInfo(purchase.product_id, purchase);
            return {
                purchase,
                name: productInfo.name,
                price: productInfo.price,
                currency: productInfo.currency,
                emoji: productInfo.emoji,
                formattedDate: formatDate(purchase.purchase_time ? new Date(purchase.purchase_time).getTime() : undefined)
            };
        });
        
        // Compute total value using stored pricing first
        if (successfulPurchases.length === 0) {
            cachedTotalValue = "$0.00 USD";
            return;
        }
        
        let total = 0;
        let currency = "USD";
        
        // Detect currency from original_json data first
        for (const purchase of successfulPurchases) {
            const originalData = purchase.original_json;
            if (originalData?.priceCurrencyCode) {
                currency = originalData.priceCurrencyCode;
                break;
            }
        }
        
        // Calculate total using original_json pricing data
        successfulPurchases.forEach((purchase) => {
            const originalData = purchase.original_json;
            if (originalData?.formattedPrice) {
                // Use the currency from this purchase if we haven't detected one yet
                if (originalData.priceCurrencyCode && currency === "USD") {
                    currency = originalData.priceCurrencyCode;
                }
                
                const priceMatch = originalData.formattedPrice.match(/[\d,]+\.?\d*/);
                const storedPrice = priceMatch ? parseFloat(priceMatch[0].replace(/,/g, '')) : 0;
                total += storedPrice;
            } else {
                // Fallback to product info calculation
                const productInfo = getProductInfo(purchase.product_id, purchase);
                total += productInfo.priceValue || 0;
                
                // Update currency from product info if available
                if (productInfo.currency && currency === "USD") {
                    currency = productInfo.currency;
                }
            }
        });
        
        cachedTotalValue = `$${total.toFixed(2)} ${currency}`;
    }

    onMount(() => {
        // Subscribe to IAP store for product info
        const unsubscribe = iapStore.subscribe((state) => {
            iapState = state;
        });

        // Load purchase history optimistically
        async function loadPurchaseHistoryOptimistic() {
            try {
                // Try to get cached data first
                const authState = await centralizedAuth.getState();
                if (!authState.user?.id) {
                    throw new Error('No authenticated user found');
                }
                
                const cached = cacheManager.get<IAPTransactionRecord[]>(cacheKeys.userPurchases(authState.user.id));
                if (cached && cached.length > 0) {
                    purchases = cached;
                    computeDisplayData(cached);
                    isInitialized = true;
                    showLoading = false;
                    
                    // Load fresh data in background
                    setTimeout(async () => {
                        try {
                            if (authState.user?.id) {
                                const freshPurchases = await getUserIAPTransactions(authState.user.id);
                                if (freshPurchases.length > 0) {
                                    purchases = freshPurchases;
                                    computeDisplayData(freshPurchases);
                                    setCachedPurchases(freshPurchases, authState.user.id);
                                }
                            }
                        } catch (error) {
                            console.error('Background refresh failed:', error);
                        }
                    }, 100);
                    return;
                }
                
                // If no cache, show loading and fetch fresh data
                showLoading = true;
                
                const freshPurchases = await getUserIAPTransactions(authState.user.id);
                purchases = freshPurchases;
                computeDisplayData(freshPurchases);
                setCachedPurchases(freshPurchases, authState.user.id);
                isInitialized = true;
                
            } catch (err) {
                console.error('Failed to load purchase history:', err);
                error = err instanceof Error ? err.message : 'Failed to load purchase history';
            } finally {
                showLoading = false;
            }
        }
        
        loadPurchaseHistoryOptimistic();
        
        // Set up periodic background refresh every 10 minutes
        const refreshInterval = setInterval(() => {
            loadPurchaseHistoryOptimistic().catch(console.warn);
        }, 10 * 60 * 1000);

        return () => {
            unsubscribe();
            clearInterval(refreshInterval);
        };
    });

    function goBack() {
        goto("/settings");
    }
    
    async function loadPurchaseHistory() {
        loading = true;
        showLoading = true;
        error = null;
        
        try {
            const authState = await centralizedAuth.getState();
            if (!authState.user?.id) {
                throw new Error('No authenticated user found');
            }
            
            const freshPurchases = await getUserIAPTransactions(authState.user.id);
            purchases = freshPurchases;
            computeDisplayData(freshPurchases);
            setCachedPurchases(freshPurchases, authState.user.id);
            isInitialized = true;
        } catch (err) {
            console.error('Failed to load purchase history:', err);
            error = err instanceof Error ? err.message : 'Failed to load purchase history';
        } finally {
            loading = false;
            showLoading = false;
        }
    }

    function getProductInfo(productId: string, purchase?: IAPTransactionRecord) {
        // First priority: Use stored pricing from original_json (no flashing)
        const originalData = purchase?.original_json;
        if (originalData?.formattedPrice && originalData?.priceCurrencyCode) {
            const consumable = iapProductConfig.consumables.find((p) => p.id === productId);
            const subscription = iapProductConfig.subscriptions.find((p) => p.id === productId);
            
            return {
                name: consumable ? `${consumable.tokens} tokens` : (subscription?.name || productId),
                price: originalData.formattedPrice,
                priceValue: parseFloat(originalData.formattedPrice.replace(/[^0-9.]/g, '')) || 0,
                emoji: consumable?.emoji || subscription?.emoji || "📦",
                type: consumable ? "consumable" : (subscription ? "subscription" : "unknown"),
                currency: originalData.priceCurrencyCode,
            };
        }

        // Second priority: Try to get from store products (has actual pricing)
        const storeProduct = iapState.products?.find((p: any) => p.productId === productId);
        if (storeProduct && storeProduct.formattedPrice) {
            const consumable = iapProductConfig.consumables.find((p) => p.id === productId);
            const subscription = iapProductConfig.subscriptions.find((p) => p.id === productId);
            
            return {
                name: consumable ? `${consumable.tokens} tokens` : (subscription?.name || storeProduct.title),
                price: storeProduct.formattedPrice,
                priceValue: parseFloat(storeProduct.formattedPrice.replace(/[^0-9.]/g, '')) || 0,
                emoji: consumable?.emoji || subscription?.emoji || "📦",
                type: consumable ? "consumable" : (subscription ? "subscription" : "unknown"),
                currency: storeProduct.priceCurrencyCode || "USD",
            };
        }

        // Fallback to config data if no stored or store pricing available
        const consumable = iapProductConfig.consumables.find((p) => p.id === productId);
        if (consumable) {
            return {
                name: `${consumable.tokens} tokens`,
                price: consumable.price,
                priceValue: parseFloat(consumable.price.replace(/[^0-9.]/g, '')) || 0,
                emoji: consumable.emoji,
                type: "consumable",
                currency: "USD",
            };
        }

        // Final fallback
        return {
            name: productId,
            price: "Unknown",
            priceValue: 0,
            emoji: "📦",
            type: "unknown",
            currency: "USD",
        };
    }

    function formatDate(timestamp?: number): string {
        if (!timestamp) return "Unknown date";

        try {
            const date = new Date(timestamp);
            const day = date.getDate().toString().padStart(2, "0");
            const month = (date.getMonth() + 1).toString().padStart(2, "0");
            const year = date.getFullYear().toString().slice(-2);
            return `${day}/${month}/${year}`;
        } catch {
            return "Invalid date";
        }
    }
</script>

<AppLayout
    title="Purchase History"
    showBackButton={true}
    onBack={goBack}
    maxWidth="max-w-4xl"
>
    {#if showLoading}
        <!-- Loading state - only show when no cached data -->
        <div class="flex justify-center items-center py-12">
            <div
                class="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"
            ></div>
        </div>
    {/if}
    
    {#if error}
        <!-- Error state -->
        <Card class="mb-6">
            <CardContent class="pt-6">
                <div class="text-center">
                    <div
                        class="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md"
                    >
                        <div class="flex items-center justify-center">
                            <svg
                                class="w-5 h-5 text-destructive mr-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                                />
                            </svg>
                            <span class="text-sm text-destructive">{error}</span>
                        </div>
                    </div>
                    <Button
                        onclick={() => loadPurchaseHistory()}
                        variant="outline"
                    >
                        Try Again
                    </Button>
                </div>
            </CardContent>
        </Card>
    {/if}
    
    {#if showContent && purchases.length === 0}
        <!-- Empty state -->
        <Card class="mb-6">
            <CardContent class="pt-6">
                <div class="text-center py-8">
                    <CreditCardIcon
                        class="w-12 h-12 mx-auto text-muted-foreground mb-4"
                    />
                    <h3 class="text-lg font-semibold text-foreground mb-2">
                        No purchases yet
                    </h3>
                    <p class="text-muted-foreground mb-4">
                        You haven't made any purchases yet. Check out our
                        packages to get started.
                    </p>
                    <Button onclick={() => goto("/packages")} variant="outline">
                        Browse Packages
                    </Button>
                </div>
            </CardContent>
        </Card>
    {/if}
    
    {#if showContent && purchases.length > 0}
        <!-- Summary card -->
        {#if purchases.length > 0}
            <Card class="mb-4">
                <CardContent>
                    <div
                        class="grid grid-cols-2 md:grid-cols-4 gap-4"
                    >
                        <div class="text-left">
                            <div class="text-xl font-bold text-primary">
                                {purchases.filter((p) => p.purchase_state === 0)
                                    .length}
                            </div>
                            <div class="text-sm text-muted-foreground">
                                Total Purchases
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="text-xl font-bold text-primary">
                                {cachedTotalValue}
                            </div>
                            <div class="text-sm text-muted-foreground">
                                Total Value
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        {/if}
        <!-- Purchases list using cached display data -->
        <div class="space-y-3">
            {#each cachedPurchaseDisplays as displayData (displayData.purchase.purchase_token)}
                <Card>
                    <CardContent class="px-4">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="text-2xl">{displayData.emoji}</div>
                                <div>
                                    <div class="font-semibold text-foreground">
                                        {displayData.name}
                                    </div>
                                    <div class="text-sm text-muted-foreground">
                                        {displayData.formattedDate}
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 text-right">
                                <div class="mr-2">
                                    <div class="font-semibold text-foreground">
                                        {displayData.price}
                                    </div>
                                    <div class="text-xs text-muted-foreground">
                                        {displayData.currency}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            {/each}
        </div>
    {/if}
</AppLayout>
