<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";
  import { ModeWatcher } from "mode-watcher";
  import { Toaster } from "$lib/components/ui/sonner";
  import GlobalLoading from "$lib/components/GlobalLoading.svelte";
  import Onboarding from "$lib/components/Onboarding.svelte";
  import FooterNavigation from "$lib/components/FooterNavigation.svelte";
  import SubscriptionManager from "$lib/components/SubscriptionManager.svelte";
  import { centralizedAuth } from "$lib/stores/unifiedAuth";
  import { loadingActions } from "$lib/stores/loadingStore";
  import { biometricActions, shouldRequireOnStartup, isBiometricAvailable } from "$lib/stores/biometricStore";
  import { toast } from "svelte-sonner";
  import { ShieldIcon } from "lucide-svelte";

  $: shouldShowApp = centralizedAuth.shouldShowApp;
  $: shouldShowOnboarding = centralizedAuth.shouldShowOnboarding;
  $: shouldShowLogin = centralizedAuth.shouldShowLogin;

  let initializationComplete = false;
  let initializationErrors: string[] = [];
  let biometricAuthRequired = false;
  let biometricAuthComplete = false;

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

      // Initialize biometric store after auth is ready
      if (result.authReady) {
        await biometricActions.initialize();
        
        // Only check for startup auth if biometric is actually enabled
        const settings = await biometricActions.loadSettings();
        if (settings.enabled && settings.require_on_startup && $isBiometricAvailable) {
          biometricAuthRequired = true;
          await handleBiometricAuth();
        } else {
          biometricAuthComplete = true;
        }
      } else {
        biometricAuthComplete = true;
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      initializationErrors = [errorMessage];
      console.error('Failed to initialize application:', error);
      toast.error(`Failed to initialize: ${errorMessage}`);
      biometricAuthComplete = true;
    } finally {
      initializationComplete = true;
      loadingActions.hideApp();
    }
  });

  async function handleBiometricAuth() {
    try {
      loadingActions.showApp('Biometric authentication required...');
      const success = await biometricActions.authenticate('Authenticate to access your secure data');
      
      if (success) {
        toast.success('Biometric authentication successful');
        biometricAuthComplete = true;
      } else {
        toast.error('Biometric authentication failed. Please try again.');
        // Don't mark as complete - keep prompting
        biometricAuthComplete = false;
      }
    } catch (error) {
      console.error('Biometric authentication error:', error);
      toast.error(`Authentication error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Don't mark as complete - keep prompting
      biometricAuthComplete = false;
    } finally {
      loadingActions.hideApp();
    }
  }

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
  {:else if $shouldShowApp && biometricAuthComplete}
    <SubscriptionManager />
    
    <div class="flex-1" style="height: calc(100vh - 4rem); max-height: calc(100vh - 4rem); overflow: hidden;">
      <slot />
    </div>
    <div style="height: 4rem; min-height: 4rem; max-height: 4rem; flex-shrink: 0;">
      <FooterNavigation />
    </div>
  {:else if biometricAuthRequired && !biometricAuthComplete}
    <div class="flex justify-center items-center h-full">
      <div class="text-center max-w-sm mx-auto p-6">
        <div class="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <ShieldIcon class="w-8 h-8 text-primary" />
        </div>
        <h2 class="text-xl font-semibold mb-2">Security Check Required</h2>
        <p class="text-sm text-muted-foreground mb-6">
          Please authenticate with biometrics to access your secure data.
        </p>
        <div class="space-y-3">
          <button 
            class="w-full px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium"
            onclick={() => handleBiometricAuth()}
          >
            Authenticate with Biometrics
          </button>
          <button 
            class="w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            onclick={() => { biometricAuthComplete = true; toast.info('Biometric authentication skipped'); }}
          >
            Skip for now
          </button>
        </div>
      </div>
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
