<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { ArrowLeftIcon } from "lucide-svelte";
  
  export let title: string = "";
  export let showBackButton: boolean = false;
  export let maxWidth: string = "max-w-4xl";
  export let padding: string = "p-4";
  export let paddingBottom: string = "pb-4";
  export let onBack: (() => void) | null = null;
</script>

<!-- Strict content container - fills available space exactly -->
<div class="bg-background text-foreground w-full h-full flex flex-col" style="max-height: 100%; overflow: hidden;">
  <div class="w-full {maxWidth} mx-auto {padding} h-full flex flex-col" style="max-height: 100%; overflow: hidden;">
    <!-- Page Header - Fixed size -->
    {#if title || showBackButton}
      <header class="flex items-center justify-between mb-6" style="flex-shrink: 0;">
        <div class="flex items-center gap-4">
          {#if showBackButton}
            <Button
              variant="outline"
              size="icon"
              class="rounded-full"
              onclick={onBack}
              aria-label="Go back"
            >
              <ArrowLeftIcon />
            </Button>
          {/if}
          {#if title}
            <h1 class="text-2xl font-semibold">{title}</h1>
          {/if}
        </div>
        <!-- Header Actions Slot -->
        <div class="flex items-center gap-2">
          <slot name="header-actions" />
        </div>
      </header>
    {/if}

    <!-- Main Content - ONLY this scrolls if content exceeds available space -->
    <main class="flex-1 overflow-y-auto {paddingBottom}" style="min-height: 0; max-height: 100%;">
      <slot />
    </main>
  </div>
</div>

<style>
  /* Hide scrollbars completely */
  .overflow-y-auto::-webkit-scrollbar {
    display: none;
  }
  
  .overflow-y-auto {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
</style>
