<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { centralizedAuth } from "../stores/unifiedAuth";
    import { loadingActions } from "../stores/loadingStore";
    import OnboardingIntro from "./onboarding/OnboardingIntro.svelte";
    import OnboardingSecurity from "./onboarding/OnboardingSecurity.svelte";
    import OnboardingAuth from "./onboarding/OnboardingAuth.svelte";
    import OnboardingProfile from "./onboarding/OnboardingProfile.svelte";
    import { Button } from "./ui/button";

    const dispatch = createEventDispatcher();

    const totalSteps = 3;

    let isAuthenticating = $state(false);
    let onboardingComplete = $state(false);
    let currentStep = $state(1);
    
    const shouldShowApp = centralizedAuth.shouldShowApp;

    // Force re-evaluation of authentication state on component mount
    // This helps ensure proper state after logout/restart
    $effect(() => {
        // Trigger a re-check of authentication state
        const isAuthenticated = $centralizedAuth.isAuthenticated;
        const isInitialized = $centralizedAuth.isInitialized;
        const isLoading = $centralizedAuth.isLoading;

        console.log('Onboarding: Auth state check:', {
            isAuthenticated,
            isInitialized,
            isLoading,
            shouldShowLogin: !isAuthenticated && (isInitialized || isLoading)
        });

        // If we're not authenticated and initialized, ensure we're showing the right flow
        if (!isAuthenticated && (isInitialized || isLoading)) {
            console.log('Onboarding: User not authenticated, showing auth flow');
        }
    });

    // Sync local states with centralized auth state
    $effect(() => {
        const wasCompleted = onboardingComplete;
        onboardingComplete = centralizedAuth.isOnboardingCompleted();

        // If onboarding was just marked as completed, dispatch the complete event
        if (!wasCompleted && onboardingComplete) {
            dispatch('complete');
        }
    });

    $effect(() => {
        const centralizedStep = centralizedAuth.getCurrentOnboardingStep();
        if (centralizedStep !== currentStep) {
            currentStep = centralizedStep;
        }
    });
    
    onMount(() => {
        // The reactive effect above will sync with the centralized auth state
        // and dispatch 'complete' if onboarding was previously completed
    });
    
    let wasAuthenticated = $state(false);

    $effect(() => {
        const isAuth = $centralizedAuth.isAuthenticated;
        const hasUser = !!$centralizedAuth.user;

        if (isAuth && hasUser) {
            wasAuthenticated = true;
        }

        if (!isAuth && !hasUser && wasAuthenticated && currentStep === 4) {
            centralizedAuth.resetOnboardingState();
            wasAuthenticated = false;
        }
        });
    
    const isWaitingForProfile = $derived(
        $centralizedAuth.isAuthenticated && 
        $centralizedAuth.user && 
        !$centralizedAuth.profileLoaded
    );
    
    $effect(() => {
        if (isWaitingForProfile) {
            loadingActions.showProfile();
        } else {
            loadingActions.hideProfile();
        }
    });
    
    function nextStep() {
        if (currentStep < totalSteps) {
            const newStep = currentStep + 1;
            centralizedAuth.setCurrentOnboardingStep(newStep);
            // Force local update for immediate UI response
            currentStep = newStep;
        }
    }

    function prevStep() {
        if (currentStep > 1) {
            const newStep = currentStep - 1;
            centralizedAuth.setCurrentOnboardingStep(newStep);
            // Force local update for immediate UI response
            currentStep = newStep;
        }
    }

    async function handleAuthSuccess() {
        isAuthenticating = false;

        // Show loading while we check profile status
        loadingActions.showApp();

        try {
            // Add a small delay to ensure loading is visible
            await new Promise(resolve => setTimeout(resolve, 100));
            // Wait for profile to load if not already loaded
            if (!$centralizedAuth.profileLoaded) {
                let attempts = 0;
                const maxAttempts = 30; // Max 15 seconds (500ms * 30)

                while (!$centralizedAuth.profileLoaded && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    attempts++;
                }

                // If still not loaded after timeout, try to refresh
                if (!$centralizedAuth.profileLoaded) {
                    try {
                        await centralizedAuth.refreshProfile();
                        // Wait a bit more for the refresh to complete
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (error) {
                        // Continue anyway
                    }
                }
            }

            // Now check onboarding status and decide what to do
            if ($centralizedAuth.profileLoaded && $centralizedAuth.profile && $centralizedAuth.profile.onboarding_complete) {
                // Onboarding already complete - mark as complete and go directly to main app
                centralizedAuth.markOnboardingCompleted();
                dispatch('complete');
            } else if ($centralizedAuth.profileLoaded) {
                // Profile is loaded but onboarding not complete - set step to profile setup
                centralizedAuth.setCurrentOnboardingStep(4);
            } else {
                // Profile still not loaded - keep current step (don't show profile setup yet)
                // The loading will continue until profile loads
            }

            // Force a minimum delay to prevent any microsecond flash
            await new Promise(resolve => setTimeout(resolve, 500));
        } finally {
            // Hide loading after decision is made and minimum delay
            loadingActions.hideApp();
        }
    }
    
    function handleAuthStart() {
        isAuthenticating = true;
    }
    
    function handleAuthError() {
        isAuthenticating = false;
    }

    function handleProfileComplete() {
        centralizedAuth.markOnboardingCompleted();
        dispatch('complete');
    }
</script>

<!-- Onboarding content - layout controls when this component is rendered -->
{#if onboardingComplete}
  <!-- Onboarding already complete - don't show anything -->
{:else if isWaitingForProfile}
    <!-- Let GlobalLoading handle this state -->
  {:else if currentStep === 3}
    <!-- Authentication Step (Step 3) -->
    <OnboardingAuth 
        on:authSuccess={handleAuthSuccess}
        on:authStart={handleAuthStart}
        on:authError={handleAuthError}
    />
  {:else if currentStep === 4 && $centralizedAuth.profileLoaded && $centralizedAuth.profile && !$centralizedAuth.profile.onboarding_complete}
    <!-- Profile Setup Step (Step 4) - Only show if profile is loaded, exists, and onboarding not yet complete -->
    <OnboardingProfile on:complete={handleProfileComplete} />
  {:else}
    <!-- Regular Onboarding Layout for Steps 1 & 2 -->
    <div class="min-h-screen flex flex-col relative">
        <!-- Main Content Container -->
        <div class="flex-1 flex flex-col justify-between items-center px-8 py-16">
            <!-- Top Section: Image and Text -->
            <div class="flex-1 flex flex-col justify-center items-center max-w-md mx-auto">
                {#if currentStep === 1}
                    <OnboardingIntro />
                {:else if currentStep === 2}
                    <OnboardingSecurity />
                {/if}
            </div>

            <!-- Bottom Section: Indicator and Buttons (only for steps 1-2, step 3 handles its own navigation) -->
            {#if currentStep <= 2}
                <div class="w-full mx-auto">
                    <!-- Progress Indicator (showing steps 1-2-3, but navigation only for 1-2) -->
                    <div class="flex justify-center gap-2 mb-16">
                        {#each Array(3) as _, i}
                            <div
                                class="w-3 h-3 rounded-full transition-colors duration-300 {i + 1 <= currentStep
                                    ? 'bg-primary'
                                    : 'bg-muted'}"
                            ></div>
                        {/each}
                    </div>

                    <!-- Navigation Buttons -->
                    <div class="flex justify-center items-center px-2 pb-12 gap-6">
                        <!-- Back Button -->
                        {#if currentStep !== 1}
                            <Button 
                                variant="outline" 
                                size="lg"
                                class="w-1/2" 
                                onclick={prevStep}
                            >
                                Back
                            </Button>
                        {/if}

                        <!-- Next Button -->
                        <Button 
                            size="lg"
                            class="w-1/2" 
                            onclick={nextStep}
                        >
                            {currentStep === 2 ? "Get Started" : "Next"}
                        </Button>
                    </div>
                </div>
            {/if}
        </div>
    </div>
  {/if}
