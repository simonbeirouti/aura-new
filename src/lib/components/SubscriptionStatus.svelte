<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { CrownIcon, CoinsIcon } from "lucide-svelte";
  import { activeSubscriptions, tokenBalance } from "$lib/stores/userStore";

  $: dbSubscriptions = $activeSubscriptions;
  $: tokens = $tokenBalance;
  $: hasActiveSub = dbSubscriptions.length > 0;
  $: availableTokens = tokens.tokens_available;

  export let showTokens = true;
  export let showSubscription = true;
  export let compact = false;
</script>

{#if compact}
  <!-- Compact display for headers/navigation -->
  <div class="flex items-center gap-2">
    {#if showSubscription && hasActiveSub}
      <Badge variant="default" class="flex items-center gap-1">
        <CrownIcon class="w-3 h-3" />
        Premium
      </Badge>
    {/if}
    
    {#if showTokens}
      <Badge variant="secondary" class="flex items-center gap-1">
        <CoinsIcon class="w-3 h-3" />
        {availableTokens.toLocaleString()}
      </Badge>
    {/if}
  </div>
{:else}
  <!-- Full display for pages/cards -->
  <div class="space-y-2">
    {#if showSubscription}
      <div class="flex items-center gap-2">
        <CrownIcon class="w-4 h-4 text-primary" />
        <span class="text-sm font-medium">
          {#if hasActiveSub}
            Premium Active
            {#if dbSubscriptions.length > 0}
              <span class="text-xs text-muted-foreground ml-1">
                ({dbSubscriptions[0].product_id})
              </span>
            {/if}
          {:else}
            Free Plan
          {/if}
        </span>
      </div>
    {/if}

    {#if showTokens}
      <div class="flex items-center gap-2">
        <CoinsIcon class="w-4 h-4 text-amber-500" />
        <span class="text-sm">
          <span class="font-medium">{availableTokens.toLocaleString()}</span>
          <span class="text-muted-foreground">tokens available</span>
        </span>
      </div>
    {/if}
  </div>
{/if}
