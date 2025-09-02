<script lang="ts">
  import { loadingStore } from '../stores/loadingStore';
  import { fade } from 'svelte/transition';

  // Subscribe to loading state
  $: loadingState = $loadingStore;
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

