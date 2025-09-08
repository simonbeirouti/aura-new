<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { fade } from "svelte/transition";
  import "../app.css";
  import { ModeWatcher } from "mode-watcher";
  import { Toaster } from "$lib/components/ui/sonner";
  import { Button } from "$lib/components/ui/button";
  import GlobalLoading from "$lib/components/GlobalLoading.svelte";
  import Onboarding from "$lib/components/Onboarding.svelte";
  import FooterNavigation from "$lib/components/FooterNavigation.svelte";
  import SubscriptionManager from "$lib/components/SubscriptionManager.svelte";
  import FloatingDebugger from "$lib/components/FloatingDebugger.svelte";
  import { loadingActions } from "$lib/stores/loadingStore";
  import { biometricActions, isBiometricAvailable } from "$lib/stores/biometricStore";
  import { toast } from "svelte-sonner";
  import { ShieldIcon } from "lucide-svelte";

  // Import derived stores directly to avoid circular dependencies
  import { shouldShowApp, shouldShowOnboarding, shouldShowLogin, centralizedAuth } from "$lib/stores/unifiedAuth";

  // Get access to the main auth store
  $: authStore = centralizedAuth.getStore();

  // isReady is accessed directly from the auth store

  // Debug derived store values - logging removed for production

  let initializationComplete = false;
  let initializationErrors: string[] = [];
  let biometricAuthRequired = false;
  let biometricAuthComplete = false;
  let lastVisibilityCheck = Date.now();
  let cleanupVisibilityHandler: (() => void) | null = null;

  onMount(async () => {
    loadingActions.showApp();

    // Setup visibility change handler for emergency cleanup
    cleanupVisibilityHandler = setupVisibilityHandler() || null;

    try {
      const result = await centralizedAuth.initialize();

      if (result.errors.length > 0) {
        initializationErrors = result.errors;

        // Show errors to user
        result.errors.forEach(error => {
          toast.error(`Initialization Error: ${error}`);
        });
      }

      // Initialize biometric store only if user is authenticated
      const currentState = get(centralizedAuth.getStore());
      if (result.authReady && currentState.isAuthenticated) {
        try {
          await biometricActions.initialize();

          // Only check for startup auth if biometric is actually enabled
          const settings = await biometricActions.loadSettings();
          if (settings && settings.enabled && settings.require_on_startup && $isBiometricAvailable) {
            biometricAuthRequired = true;
            loadingActions.hideApp();
            await handleBiometricAuth();
          } else {
            biometricAuthComplete = true;
          }
        } catch (biometricError) {
          biometricAuthComplete = true;
        }
      } else {
        biometricAuthComplete = true;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      initializationErrors = [errorMessage];
      toast.error(`Failed to initialize: ${errorMessage}`);
      biometricAuthComplete = true;
    } finally {
      initializationComplete = true;
      loadingActions.hideApp();
    }
  });

  async function handleBiometricAuth() {
    try {
      loadingActions.showApp();
      const success = await biometricActions.authenticate('Authenticate to access your secure data');
      
      if (success) {
        biometricAuthComplete = true;
      } else {
        toast.error('Biometric authentication failed. Please try again.');
        // Don't mark as complete - keep prompting
        biometricAuthComplete = false;
      }
    } catch (error) {
      toast.error(`Authentication error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Don't mark as complete - keep prompting
      biometricAuthComplete = false;
    } finally {
      loadingActions.hideApp();
    }
  }

  function handleOnboardingComplete() {
    // Check if onboarding is already complete to avoid unnecessary profile refresh
    if ($authStore.profileLoaded && $authStore.profile?.onboarding_complete) {
      // Onboarding already complete, immediately hide loading and return
      // No need for delays or profile refresh
      loadingActions.hideApp();
      return;
    }

    // Show success feedback before transitioning
    loadingActions.showApp();

    // Add a small delay to show completion feedback and prevent flash
    setTimeout(async () => {
      try {
        await centralizedAuth.completeOnboarding();
        // Small additional delay after profile refresh to ensure smooth transition
        setTimeout(() => {
          loadingActions.hideApp();
        }, 200);
      } catch (error) {
        loadingActions.hideApp();
      }
    }, 300);
  }

  // Force hide loading after a timeout to prevent infinite loading
  let loadingTimeout: NodeJS.Timeout | null = null;

  $: if (initializationComplete && !biometricAuthRequired) {
    // Clear any existing timeout
    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
    }
    // Set new timeout to hide loading
    loadingTimeout = setTimeout(() => {
      loadingActions.hideApp();
    }, 2000);
  }

  // Handle app visibility changes for emergency cleanup
  function setupVisibilityHandler() {
    if (typeof document !== 'undefined') {
      const handleVisibilityChange = () => {
        if (!document.hidden) {
          const now = Date.now();
          const timeAway = now - lastVisibilityCheck;

          // If app was away for more than 30 minutes, trigger emergency cleanup
          if (timeAway > 30 * 60 * 1000) {
            performEmergencyCleanup();
          }

          lastVisibilityCheck = now;
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      // Return cleanup function
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }

  async function performEmergencyCleanup() {
    try {
      // Clear all loading states
      const { loadingStore } = await import('$lib/stores/loadingStore');
      loadingStore.clear();

      // Emergency cleanup for key stores
      try {
        (centralizedAuth as any).emergencyCleanup?.();
      } catch (error) {
        // Continue silently on auth cleanup error
      }

      // Import and cleanup dataStore
      try {
        const { dataStore } = await import('$lib/stores/dataStore');
        (dataStore as any).emergencyCleanup?.();
      } catch (error) {
        // Continue silently on dataStore cleanup error
      }

      // Import and cleanup purchaseStore
      const { purchaseManager } = await import('$lib/stores/purchaseStore');
      purchaseManager.clearAllPurchaseErrors();
    } catch (error) {
      // Continue silently on emergency cleanup error
    }
  }

  // Cleanup timeout on destroy
  onDestroy(() => {
    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
    }

    // Cleanup visibility handler
    if (cleanupVisibilityHandler) {
      cleanupVisibilityHandler();
    }
  });
</script>

<div class="fixed inset-0 flex flex-col" style="height: 100vh; max-height: 100vh; overflow: hidden;">
  {#if !initializationComplete}
    <!-- Show errors if any, otherwise let GlobalLoading handle the loading state -->
    {#if initializationErrors.length > 0}
      <div class="flex justify-center items-center h-full bg-background">
        <div class="text-center">
          <div class="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p class="text-sm text-destructive font-medium mb-2">Initialization Errors:</p>
            {#each initializationErrors as error}
              <p class="text-xs text-destructive">{error}</p>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  {:else if biometricAuthRequired && !biometricAuthComplete}
    <div class="flex justify-center items-center h-full bg-background" in:fade={{ duration: 300 }}>
      <div class="text-center max-w-sm mx-auto p-6">
        <div class="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <ShieldIcon class="w-8 h-8 text-primary" />
        </div>
        <h2 class="text-xl font-semibold mb-2">Security Check Required</h2>
        <p class="text-sm text-muted-foreground mb-6">
          Please authenticate with biometrics to access your secure data.
        </p>
        <div class="space-y-3">
          <Button
            onclick={() => handleBiometricAuth()}
          >
            Authenticate with Biometrics
          </Button>
        </div>
      </div>
    </div>
  {:else}
    <!-- Show login for unauthenticated users -->
    {#if $shouldShowLogin}
      <Onboarding on:complete={handleOnboardingComplete} />
    {/if}

    <!-- Main app content - show when authenticated and biometric check passed -->
    {#if $shouldShowApp && biometricAuthComplete}
      <div in:fade={{ duration: 400 }} class="relative">
        <SubscriptionManager />

        <div class="flex-1" style="height: calc(100vh - 4rem); max-height: calc(100vh - 4rem); overflow: hidden;">
          <slot />
        </div>
        <div style="height: 4rem; min-height: 4rem; max-height: 4rem; flex-shrink: 0;">
          <FooterNavigation />
        </div>

        <!-- Show onboarding as overlay for authenticated users who haven't completed it -->
        {#if $shouldShowOnboarding}
          <div class="absolute inset-0 z-50">
            <Onboarding on:complete={handleOnboardingComplete} />
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<ModeWatcher />
<Toaster position="top-center" />
<GlobalLoading />

<!-- Floating Debugger -->
<FloatingDebugger />
