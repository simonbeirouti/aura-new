<script lang="ts">
    import { goto } from "$app/navigation";
    import AppLayout from "$lib/components/AppLayout.svelte";
    import { iapStore, iapProductConfig } from "$lib/stores/iapStore";
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
    import { activeSubscriptions as dbActiveSubscriptions } from "$lib/stores/userStore";

    let purchasingProduct = "";
    let selectedTab = "monthly";

    // Reactive state from stores (managed by SubscriptionManager in layout)
    $: iapState = $iapStore;
    $: subscriptions = iapProductConfig.subscriptions;
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

    // Helper to get product display info
    function getProductInfo(productId: string) {
        const storeProduct = iapState.products.find(
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

    async function handlePurchase(productId: string) {
        if (purchasingProduct || !iapState.canMakePayments) return;
        
        purchasingProduct = productId;
        
        try {
            // The SubscriptionManager in the layout handles the purchase processing
            await iapStore.purchaseProduct(productId, "subs");
        } catch (error) {
            console.error('Purchase failed:', error);
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
    {#if !iapState.isInitialized}
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
                                        !iapState.canMakePayments}
                                >
                                    {#if purchasingProduct === subscription.id}
                                        Processing...
                                    {:else if !iapState.canMakePayments}
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
                                        !iapState.canMakePayments}
                                >
                                    {#if purchasingProduct === subscription.id}
                                        Processing...
                                    {:else if !iapState.canMakePayments}
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
