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
    import {
        CalendarIcon,
        CrownIcon,
        CheckIcon,
        SparklesIcon,
        ZapIcon,
        ShieldIcon,
        InfinityIcon,
        StarIcon,
    } from "lucide-svelte";
    import { activeSubscriptions as dbActiveSubscriptions } from "$lib/stores/userStore";

    let purchasingProduct = "";
    let selectedTab = "monthly";

    // Reactive state from stores (managed by SubscriptionManager in layout)
    $: iapState = $iapStore;
    $: subscriptions = iapProductConfig.subscriptions;
    $: dbSubscriptions = $dbActiveSubscriptions.filter(
        (sub) => sub.subscription_status === "active",
    );
    $: hasActiveSubscription = dbSubscriptions.length > 0 && !purchasingProduct;

    // Show content immediately if IAP is initialized OR we have subscription data
    $: showContent = iapState.isInitialized || dbSubscriptions.length > 0;
    $: showLoading = !iapState.isInitialized && dbSubscriptions.length === 0;

    // Define subscription benefits
    const subscriptionBenefits = [
        {
            icon: InfinityIcon,
            title: "Unlimited AI Interactions",
            description: "No daily limits on AI conversations and assistance",
        },
        {
            icon: ZapIcon,
            title: "Priority Processing",
            description: "Faster response times and priority queue access",
        },
        {
            icon: SparklesIcon,
            title: "Advanced AI Models",
            description:
                "Access to the latest and powerful AI capabilities",
        },
        {
            icon: ShieldIcon,
            title: "Enhanced Privacy",
            description: "Premium data protection and privacy features",
        },
        {
            icon: StarIcon,
            title: "Exclusive Features",
            description: "Early access to new features and premium tools",
        },
    ];

    // Separate monthly and yearly plans
    $: monthlyPlans = subscriptions.filter((sub) => sub.id.includes("monthly"));
    $: yearlyPlans = subscriptions.filter((sub) => sub.id.includes("yearly"));

    // Helper to get product display info - prioritize localized store pricing
    function getProductInfo(productId: string) {
        const storeProduct = iapState.products.find(
            (p) => p.productId === productId,
        );

        // Always prefer store product data when available (has localized pricing)
        if (storeProduct && storeProduct.formattedPrice) {
            return {
                title: storeProduct.title || getConfigTitle(productId),
                price: storeProduct.formattedPrice,
                currency: storeProduct.priceCurrencyCode || "USD",
            };
        }

        // Fallback to config data only if store product not available or incomplete
        const subData = iapProductConfig.subscriptions.find(
            (p) => p.id === productId,
        );
        return {
            title: subData?.name || productId,
            price: subData?.price || "Loading...",
            currency: "USD", // Will be replaced once store loads
        };
    }

    // Helper to get config title for store products
    function getConfigTitle(productId: string): string {
        const subData = iapProductConfig.subscriptions.find(
            (p) => p.id === productId,
        );
        return subData?.name || productId;
    }

    async function handlePurchase(productId: string) {
        if (purchasingProduct || !iapState.canMakePayments) return;

        purchasingProduct = productId;

        try {
            // The SubscriptionManager in the layout handles the purchase processing
            await iapStore.purchaseProduct(productId, "subs");
        } catch (error) {
            console.error("Purchase failed:", error);
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
    {#if showLoading}
        <div class="flex justify-center items-center py-12">
            <div
                class="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"
            ></div>
        </div>
    {/if}

    {#if showContent}
        <!-- Active Subscription Status -->
        {#if hasActiveSubscription}
            <!-- Subscription Header -->
            <div class="text-center mb-8">
                <div
                    class="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-full mb-4"
                >
                    <CrownIcon class="w-6 h-6 text-primary" />
                </div>
                <h1 class="text-2xl font-bold mb-2">Premium Active</h1>

                <div class="grid gap-6 mt-8">
                    {#each subscriptionBenefits as benefit}
                        <div
                            class="flex items-start gap-2 rounded-lg"
                        >
                            <div
                                class="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center"
                            >
                                <svelte:component
                                    this={benefit.icon}
                                    class="w-5 h-5 text-primary"
                                />
                            </div>
                            <div class="flex-1 text-left">
                                <h4 class="font-medium mb-1">
                                    {benefit.title}
                                </h4>
                                <p class="text-sm text-muted-foreground">
                                    {benefit.description}
                                </p>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
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
                                <div
                                    class="p-4 border border-border rounded-lg"
                                >
                                    <div class="text-center mb-4">
                                        <h3 class="font-semibold text-lg mb-2">
                                            {productInfo.title}
                                        </h3>
                                        <div class="text-2xl font-bold">
                                            {productInfo.price}
                                        </div>
                                        <div
                                            class="text-sm text-muted-foreground"
                                        >
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
                                <div
                                    class="p-4 border border-border rounded-lg"
                                >
                                    <div class="text-center mb-4">
                                        <h3 class="font-semibold text-lg mb-2">
                                            {productInfo.title}
                                        </h3>
                                        <div class="text-2xl font-bold">
                                            {productInfo.price}
                                        </div>
                                        <div
                                            class="text-sm text-muted-foreground"
                                        >
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
