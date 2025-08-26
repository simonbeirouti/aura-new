<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";
  import { ModeWatcher } from "mode-watcher";
  import { Toaster } from "$lib/components/ui/sonner";
  import GlobalLoading from "$lib/components/GlobalLoading.svelte";
  import Onboarding from "$lib/components/Onboarding.svelte";
  import FooterNavigation from "$lib/components/FooterNavigation.svelte";
  import { centralizedAuth } from "$lib/stores/unifiedAuth";
  import { loadingActions } from "$lib/stores/loadingStore";
  import { toast } from "svelte-sonner";

  $: shouldShowApp = centralizedAuth.shouldShowApp;
  $: shouldShowOnboarding = centralizedAuth.shouldShowOnboarding;
  $: shouldShowLogin = centralizedAuth.shouldShowLogin;

  let initializationComplete = false;
  let initializationErrors: string[] = [];

  onMount(async () => {
    loadingActions.showApp('Initializing application...');
    
    try {
      const result = await centralizedAuth.initialize();
      
      if (result.errors.length > 0) {
        initializationErrors = result.errors;
        console.error('Initialization errors:', result.errors);
        
        // Show errors to user
        result.errors.forEach(error => {
          toast.error(`Initialization Error: ${error}`);
        });
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      initializationErrors = [errorMessage];
      console.error('Failed to initialize application:', error);
      toast.error(`Failed to initialize: ${errorMessage}`);
    } finally {
      initializationComplete = true;
      loadingActions.hideApp();
    }
  });

  function handleOnboardingComplete() {
    centralizedAuth.completeOnboarding();
  }
  

</script>

<div class="fixed inset-0 flex flex-col" style="height: 100vh; max-height: 100vh; overflow: hidden;">
  {#if !initializationComplete}
    <div class="flex justify-center items-center h-full">
      <div class="text-center">
        <div class="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4"></div>
        <p class="text-sm text-muted-foreground">Initializing application...</p>
        {#if initializationErrors.length > 0}
          <div class="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p class="text-sm text-destructive font-medium mb-2">Initialization Errors:</p>
            {#each initializationErrors as error}
              <p class="text-xs text-destructive">{error}</p>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else if $shouldShowApp}
    <div class="flex-1" style="height: calc(100vh - 4rem); max-height: calc(100vh - 4rem); overflow: hidden;">
      <slot />
    </div>
    <div style="height: 4rem; min-height: 4rem; max-height: 4rem; flex-shrink: 0;">
      <FooterNavigation />
    </div>
  {:else if $shouldShowOnboarding}
    <div class="h-full overflow-hidden">
      <Onboarding on:complete={handleOnboardingComplete} />
    </div>
  {:else if $shouldShowLogin}
    <div class="h-full overflow-hidden">
      <Onboarding on:complete={handleOnboardingComplete} />
    </div>
  {:else}
    <div class="flex justify-center items-center h-full">
      <div class="text-center">
        <div class="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4"></div>
        <p class="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  {/if}
</div>

<ModeWatcher />
<Toaster position="top-center" />
<GlobalLoading />
