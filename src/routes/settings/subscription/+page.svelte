<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { goto } from "$app/navigation";
    import AppLayout from "$lib/components/AppLayout.svelte";
    import {
        iapStore,
        iapProductConfig
    } from "$lib/stores/iapStore";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Button } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import {
        Tabs,
        TabsContent,
        TabsList,
        TabsTrigger,
    } from "$lib/components/ui/tabs";
    import { CalendarIcon, CrownIcon } from "lucide-svelte";
    import { toast } from "svelte-sonner";
    import { processSuccessfulPurchase, syncSubscriptionsWithIAP } from "$lib/utils/iapDatabase";
    import { userStore, activeSubscriptions as dbActiveSubscriptions } from "$lib/stores/userStore";
    import { authStore } from "$lib/stores/unifiedAuth";


    let purchasingProduct = "";
    let selectedTab = "monthly";

    // Subscribe to IAP store - same as IAPTester
    $: state = $iapStore;
    
    // Loading state - show spinner only when data is stale or not initialized
    $: loading = (!initialized || initialSyncInProgress) && !hasCachedData;
    let initialized = false;
    let initialSyncInProgress = false;
    
    // Check if we have cached subscription data that's still valid
    $: hasCachedData = $userStore.isInitialized && 
        $userStore.lastSubscriptionUpdate && 
        (Date.now() - $userStore.lastSubscriptionUpdate) < $userStore.cacheValidDuration;
    $: subscriptions = iapProductConfig.subscriptions;
    
    // Database controls the view - only use database subscriptions for UI state
    // But don't show as subscribed if a purchase is currently in progress
    $: dbSubscriptions = $dbActiveSubscriptions.filter(sub => sub.subscription_status === 'active');
    $: hasActiveSubscription = dbSubscriptions.length > 0 && !purchasingProduct;
    
    // Format database subscriptions for display
    $: combinedActiveSubscriptions = dbSubscriptions.map(sub => ({
        productId: sub.product_id,
        subscriptionStatus: sub.subscription_status,
        expiryTime: sub.expiry_time ? new Date(sub.expiry_time).getTime() / 1000 : undefined
    }));
    

    // Separate monthly and yearly plans
    $: monthlyPlans = subscriptions.filter((sub) => sub.id.includes("monthly"));
    $: yearlyPlans = subscriptions.filter((sub) => sub.id.includes("yearly"));

    // Helper to get product display info - same as IAPTester
    function getProductInfo(productId: string) {
        const storeProduct = state.products.find(
            (p) => p.productId === productId,
        );
        if (storeProduct) {
            return {
                title: storeProduct.title,
                price: storeProduct.formattedPrice,
                currency: storeProduct.priceCurrencyCode,
            };
        }

        // Fallback to config data if product not loaded
        const subData = iapProductConfig.subscriptions.find(
            (p) => p.id === productId,
        );
        return {
            title: subData?.name || productId,
            price: subData?.price || "Unknown",
            currency: "USD",
        };
    }


    onMount(async () => {
        const authState = await authStore.getState();
        
        if (!authState.user?.id) {
            initialized = true;
            return;
        }
        
        // Initialize user store if not already done
        if (!$userStore.isInitialized) {
            initialSyncInProgress = true;
            await userStore.initialize(authState.user.id);
        }
        
        // Check if we have valid cached data
        const now = Date.now();
        const hasValidCache = $userStore.lastSubscriptionUpdate && 
            (now - $userStore.lastSubscriptionUpdate) < $userStore.cacheValidDuration;
        
        if (!hasValidCache) {
            // Only show loading and sync if cache is stale
            initialSyncInProgress = true;
            
            try {
                // Initialize IAP store first to ensure we have current data
                if (!state.isInitialized || state.products.length === 0) {
                    const iapResult = await iapStore.initialize();
                    if (iapResult) {
                        iapStore.setupPurchaseListener();
                        await iapStore.restorePurchases("subs");
                    }
                }
                
                // Force sync to ensure database matches IAP state
                const syncResult = await syncSubscriptionsWithIAP(authState.user.id);
                
                // Refresh subscriptions after sync
                await userStore.refreshSubscriptions(true);
            } catch (error) {
                // Sync failed - continue silently but still show UI
            } finally {
                initialSyncInProgress = false;
            }
        } else {
            // We have valid cached data, just ensure IAP store is set up for purchases
            if (!state.isInitialized || state.products.length === 0) {
                // Initialize IAP in background without blocking UI
                iapStore.initialize().then(() => {
                    iapStore.setupPurchaseListener();
                }).catch(() => {});
            }
        }
        
        initialized = true;
    });


    onDestroy(() => {
        iapStore.cleanupPurchaseListener();
    });

    async function handlePurchase(productId: string) {
        if (purchasingProduct) return;
        purchasingProduct = productId;

        const initialPurchaseCount = $iapStore.purchases.length;
        const initialTransactionCount = $iapStore.transactions.length;

        try {
            await iapStore.purchaseProduct(productId, "subs");

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
                    // Save successful subscription purchase to database
                    const recentPurchase = currentState.purchases[currentState.purchases.length - 1];
                    if (recentPurchase) {
                        try {
                            // Get user ID from auth context
                            const authState = await authStore.getState();
                            if (!authState.user?.id) {
                                throw new Error('No authenticated user found');
                            }
                            
                            await processSuccessfulPurchase(
                                authState.user.id,
                                recentPurchase,
                                recentTransaction,
                                "subscription"
                            );
                            
                            // Wait for IAP process to fully complete before updating UI
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            // Update user store with new subscription data
                            await userStore.updateSubscriptions();
                            
                            // Refresh subscriptions to get latest state
                            await userStore.refreshSubscriptions(true);
                        } catch (dbError) {
                            // Failed to save subscription to database - still show success since IAP completed
                        }
                    }
                    
                    // Only show success after all processing is complete
                    toast.success("✅ Subscription completed successfully!");
                } else {
                    toast.error("❌ Subscription failed or was cancelled");
                }
            } else {
                toast.error("❌ Subscription was cancelled or failed");
            }
        } catch (error) {
            toast.error(`❌ Subscription error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            purchasingProduct = "";
        }
    }

    function goBack() {
        goto("/settings");
    }
</script>

<AppLayout
    title="Subscription"
    showBackButton={true}
    onBack={goBack}
    maxWidth="max-w-3xl"
>
    {#if loading}
        <div class="flex justify-center items-center py-12">
            <div
                class="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"
            ></div>
        </div>
    {:else}

        <!-- Active Subscription Status -->
        {#if hasActiveSubscription}
            <Card class="mb-8">
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <CrownIcon class="w-5 h-5 text-primary" />
                        Active Subscription
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div class="space-y-4">
                        {#each combinedActiveSubscriptions as subscription}
                            <div
                                class="p-4 bg-primary/10 border border-primary/20 rounded-lg"
                            >
                                <div
                                    class="flex items-center justify-between mb-2"
                                >
                                    <span class="font-medium"
                                        >{subscription.productId}</span
                                    >
                                    <Badge variant="default">
                                        {subscription.subscriptionStatus ||
                                            "active"}
                                    </Badge>
                                </div>
                                {#if subscription.expiryTime}
                                    <div
                                        class="flex items-center gap-2 text-sm text-muted-foreground"
                                    >
                                        <CalendarIcon class="w-4 h-4" />
                                        <span>
                                            Expires: {new Date(
                                                subscription.expiryTime * 1000,
                                            ).toLocaleDateString()}
                                        </span>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </CardContent>
            </Card>
        {/if}

        <!-- Available Subscription Plans -->
        {#if !hasActiveSubscription}
            {#if subscriptions.length === 0}
                <p class="text-muted-foreground text-center py-8">
                    No subscription plans configured.
                </p>
            {:else}
                <Tabs bind:value={selectedTab} class="w-full">
                <TabsList class="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="monthly">Monthly</TabsTrigger>
                    <TabsTrigger value="yearly" class="relative">
                        Yearly
                        <Badge
                            variant="secondary"
                            class="ml-2 text-xs bg-primary/10 text-primary"
                        >
                            Best Value
                        </Badge>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="monthly" class="space-y-4">
                    {#if monthlyPlans.length === 0}
                        <p class="text-muted-foreground text-center py-8">
                            No monthly plans available.
                        </p>
                    {:else}
                        {#each monthlyPlans as subscription}
                            {@const productInfo = getProductInfo(
                                subscription.id,
                            )}
                            <div class="p-4 border border-border rounded-lg">
                                <div class="text-center mb-4">
                                    <h3 class="font-semibold text-lg mb-2">
                                        {productInfo.title}
                                    </h3>
                                    <div class="text-2xl font-bold">
                                        {productInfo.price}
                                    </div>
                                    <div class="text-sm text-muted-foreground">
                                        per month
                                    </div>
                                </div>

                                <Button
                                    class="w-full mt-3"
                                    onclick={() =>
                                        handlePurchase(subscription.id)}
                                    disabled={purchasingProduct ===
                                        subscription.id ||
                                        !state.canMakePayments}
                                >
                                    {#if purchasingProduct === subscription.id}
                                        Processing...
                                    {:else if !state.canMakePayments}
                                        In-App Purchases Unavailable
                                    {:else}
                                        Subscribe Monthly
                                    {/if}
                                </Button>
                            </div>
                        {/each}
                    {/if}
                </TabsContent>

                <TabsContent value="yearly" class="space-y-4">
                    {#if yearlyPlans.length === 0}
                        <p class="text-muted-foreground text-center py-8">
                            No yearly plans available.
                        </p>
                    {:else}
                        {#each yearlyPlans as subscription}
                            {@const productInfo = getProductInfo(
                                subscription.id,
                            )}
                            <div class="p-4 border border-border rounded-lg">
                                <div class="text-center mb-4">
                                    <h3 class="font-semibold text-lg mb-2">
                                        {productInfo.title}
                                    </h3>
                                    <div class="text-2xl font-bold">
                                        {productInfo.price}
                                    </div>
                                    <div class="text-sm text-muted-foreground">
                                        per year
                                    </div>
                                </div>

                                <Button
                                    class="w-full mt-3"
                                    onclick={() =>
                                        handlePurchase(subscription.id)}
                                    disabled={purchasingProduct ===
                                        subscription.id ||
                                        !state.canMakePayments}
                                >
                                    {#if purchasingProduct === subscription.id}
                                        Processing...
                                    {:else if !state.canMakePayments}
                                        In-App Purchases Unavailable
                                    {:else}
                                        Subscribe Yearly
                                    {/if}
                                </Button>
                            </div>
                        {/each}
                    {/if}
                </TabsContent>
                </Tabs>
            {/if}
        {/if}
    {/if}
</AppLayout>
