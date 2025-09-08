<script lang="ts">
  import { onMount } from 'svelte';
  import { loadingStore } from '../stores/loadingStore';
  import { fade } from 'svelte/transition';

  // Subscribe to loading state
  $: loadingState = $loadingStore;

  // Recovery mechanism for stuck loading states
  let recoveryTimeout: NodeJS.Timeout | null = null;

  $: if (loadingState.isLoading) {
    // Set up recovery timeout if loading for more than 30 seconds
    if (recoveryTimeout) {
      clearTimeout(recoveryTimeout);
    }

    recoveryTimeout = setTimeout(() => {
      console.warn('GlobalLoading: Loading state appears stuck, attempting recovery');
      // Force clear all loading states as emergency recovery
      loadingStore.clear();
    }, 30 * 1000); // 30 seconds
  } else {
    // Clear recovery timeout when not loading
    if (recoveryTimeout) {
      clearTimeout(recoveryTimeout);
      recoveryTimeout = null;
    }
  }

  onMount(() => {
    return () => {
      // Cleanup on component destroy
      if (recoveryTimeout) {
        clearTimeout(recoveryTimeout);
      }
    };
  });
</script>

{#if loadingState.isLoading}
  <!-- Full screen loading overlay -->
  <div 
    class="fixed inset-0 bg-background z-50 flex items-center justify-center"
    in:fade={{ duration: 200 }}
    out:fade={{ duration: 200 }}
    role="dialog"
    aria-modal="true"
    aria-label="Loading"
  >
    <!-- Simple loading spinner -->
    <div class="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
  </div>
{/if}

