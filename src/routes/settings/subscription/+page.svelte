<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { goto } from "$app/navigation";
    import AppLayout from "$lib/components/AppLayout.svelte";
    import {
        iapStore,
        iapProductConfig,
        activeSubscriptions,
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

    let purchasingProduct = "";
    let selectedTab = "monthly";

    // Subscribe to IAP store - same as IAPTester
    $: state = $iapStore;
    
    // Only show loading if no subscriptions are configured at all
    $: loading = subscriptions.length === 0;
    let initialized = false;
    $: subscriptions = iapProductConfig.subscriptions;
    $: hasActiveSubscription = $activeSubscriptions.length > 0;

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
                        await iapStore.restorePurchases("subs");
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
                    toast.success("✅ Subscription completed successfully!");
                } else {
                    toast.error("❌ Subscription failed or was cancelled");
                }
            } else {
                // No purchase record created - likely cancelled or failed
                toast.error("❌ Subscription was cancelled or failed");
            }
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : "Subscription failed";
            toast.error(`❌ Subscription failed: ${errorMessage}`);
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
                        {#each $activeSubscriptions as subscription}
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
