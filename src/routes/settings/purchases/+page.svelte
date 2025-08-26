<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import AppLayout from "$lib/components/AppLayout.svelte";
    import { centralizedAuth } from "$lib/stores/unifiedAuth";
    import { iapStore, iapProductConfig } from "$lib/stores/iapStore";
    import { Card, CardContent } from "$lib/components/ui/card";
    import { Button } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import { toast } from "svelte-sonner";
    import { CreditCardIcon } from "lucide-svelte";

    interface IAPPurchase {
        orderId?: string;
        packageName?: string;
        productId: string;
        purchaseTime?: number;
        purchaseToken: string;
        purchaseState: number; // 0 = purchased, 1 = canceled
        isAutoRenewing?: boolean;
        isAcknowledged?: boolean;
        originalJson?: string;
        signature?: string;
    }

    let purchases: IAPPurchase[] = [];
    let loading = true;
    let error: string | null = null;
    let iapState: any = {};
    let lastCacheTime: number = 0;
    const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

    onMount(() => {
        // Subscribe to IAP store
        const unsubscribe = iapStore.subscribe((state) => {
            iapState = state;
            // Filter to only show in-app purchases (consumables), not subscriptions
            const allPurchases = state.purchases || [];
            purchases = allPurchases.filter(purchase => 
                iapProductConfig.consumables.some(consumable => consumable.id === purchase.productId)
            );
            
            // Update cache time when purchases are loaded
            if (state.purchases && state.purchases.length > 0 && state.lastPurchasesRestore) {
                lastCacheTime = state.lastPurchasesRestore;
            }
        });

        initializeIAPIfNeeded();

        return () => {
            unsubscribe();
        };
    });

    function goBack() {
        goto("/settings");
    }

    async function initializeIAPIfNeeded() {
        try {
            loading = true;
            error = null;

            const authState = await centralizedAuth.getState();
            if (!authState.isAuthenticated || !authState.user?.id) {
                error = "Please log in to view purchase history";
                return;
            }

            const now = Date.now();
            const isCacheExpired = !lastCacheTime || (now - lastCacheTime) > CACHE_DURATION;
            const hasNoPurchases = !iapState.purchases || iapState.purchases.length === 0;
            
            // Initialize IAP if not already initialized
            if (!iapState.isInitialized) {
                const initialized = await iapStore.initialize();
                if (initialized) {
                    iapStore.setupPurchaseListener();
                }
            }
            
            // Restore purchases if cache is expired or no purchases exist
            if (isCacheExpired || hasNoPurchases) {
                await iapStore.restorePurchases("inapp");
                // Only restore in-app purchases, not subscriptions
            }
        } catch (err) {
            console.error("Failed to initialize IAP:", err);
            error = err instanceof Error ? err.message : "Failed to initialize";
            toast.error("Failed to initialize purchase system");
        } finally {
            loading = false;
        }
    }

    function getProductInfo(productId: string) {
        // First try to get from store products (has actual pricing)
        const storeProduct = iapState.products?.find((p: any) => p.productId === productId);
        if (storeProduct) {
            // Check if it's a consumable or subscription for proper naming
            const consumable = iapProductConfig.consumables.find((p) => p.id === productId);
            const subscription = iapProductConfig.subscriptions.find((p) => p.id === productId);
            
            return {
                name: consumable ? `${consumable.tokens} tokens` : (subscription?.name || storeProduct.title),
                price: storeProduct.formattedPrice,
                priceValue: storeProduct.price, // Numeric value for calculations
                emoji: consumable?.emoji || subscription?.emoji || "📦",
                type: consumable ? "consumable" : (subscription ? "subscription" : "unknown"),
                currency: storeProduct.priceCurrencyCode,
            };
        }

        // Fallback to config data if product not loaded from store
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

    function getPurchaseStatus(purchaseState: number): string {
        switch (purchaseState) {
            case 0:
                return "Completed";
            case 1:
                return "Canceled";
            default:
                return "Unknown";
        }
    }

    function getStatusVariant(
        purchaseState: number,
    ): "default" | "secondary" | "destructive" {
        switch (purchaseState) {
            case 0:
                return "default";
            case 1:
                return "destructive";
            default:
                return "secondary";
        }
    }

    // Calculate total value of successful purchases
    function calculateTotalValue(): string {
        const successfulPurchases = purchases.filter((p) => p.purchaseState === 0);
        let total = 0;
        let currency = "USD";
        
        successfulPurchases.forEach((purchase) => {
            const productInfo = getProductInfo(purchase.productId);
            total += productInfo.priceValue || 0;
            if (productInfo.currency && productInfo.currency !== "USD") {
                currency = productInfo.currency;
            }
        });
        
        return `$${total.toFixed(2)} ${currency}`;
    }
</script>

<AppLayout
    title="Purchase History"
    showBackButton={true}
    onBack={goBack}
    maxWidth="max-w-4xl"
>
    {#if loading}
        <!-- Loading state -->
        <div class="flex justify-center items-center py-12">
            <div
                class="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"
            ></div>
        </div>
    {:else if error}
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
                        onclick={() => initializeIAPIfNeeded()}
                        variant="outline"
                    >
                        Try Again
                    </Button>
                </div>
            </CardContent>
        </Card>
    {:else if purchases.length === 0}
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
    {:else}
        <!-- Summary card -->
        {#if purchases.length > 0}
            <Card class="mb-4">
                <CardContent>
                    <div
                        class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center"
                    >
                        <div>
                            <div class="text-2xl font-bold text-primary">
                                {purchases.filter((p) => p.purchaseState === 0)
                                    .length}
                            </div>
                            <div class="text-sm text-muted-foreground">
                                Total Purchases
                            </div>
                        </div>
                        <div>
                            <div class="text-2xl font-bold text-primary">
                                {calculateTotalValue()}
                            </div>
                            <div class="text-sm text-muted-foreground">
                                Total Value
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        {/if}
        <!-- Purchases list -->
        <div class="space-y-3">
            {#each purchases as purchase (purchase.purchaseToken)}
                {@const productInfo = getProductInfo(purchase.productId)}
                <Card>
                    <CardContent class="px-4 py-2">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="text-2xl">{productInfo.emoji}</div>
                                <div>
                                    <div class="font-semibold text-foreground">
                                        {productInfo.name}
                                    </div>
                                    <div class="text-sm text-muted-foreground">
                                        {formatDate(purchase.purchaseTime)}
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 text-right">
                                <div class="mr-2">
                                    <div class="font-semibold text-foreground">
                                        {productInfo.price}
                                    </div>
                                    <div class="text-xs text-muted-foreground">
                                        {productInfo.currency}
                                    </div>
                                </div>
                                <Badge
                                    variant={getStatusVariant(
                                        purchase.purchaseState,
                                    )}
                                >
                                    {getPurchaseStatus(purchase.purchaseState)}
                                </Badge>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            {/each}
        </div>
    {/if}
</AppLayout>
