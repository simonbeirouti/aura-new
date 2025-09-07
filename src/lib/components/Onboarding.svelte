<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { get } from "svelte/store";
    import { centralizedAuth, shouldShowApp } from "../stores/unifiedAuth";
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

    // Simplified reactive effects to prevent infinite loops
    $effect(() => {
        // Only sync the current step when it changes
        const centralizedStep = centralizedAuth.getCurrentOnboardingStep();
        console.log('Reactive effect running - centralizedStep:', centralizedStep, 'currentStep:', currentStep);
        if (centralizedStep !== currentStep) {
            console.log('Onboarding step changed from', currentStep, 'to', centralizedStep);
            currentStep = centralizedStep;
            if (centralizedStep === 4) {
                console.log('User reached profile setup step (step 4)');
            }
        }
    });

    // Additional effect to handle auth state changes that might affect step
    $effect(() => {
        const authState = get(centralizedAuth.getStore());
        const isAuthenticated = authState.isAuthenticated;
        const profileLoaded = authState.profileLoaded;

        // If user becomes authenticated and profile is loaded, ensure we're on step 4
        if (isAuthenticated && profileLoaded && currentStep !== 4) {
            console.log('User authenticated with profile loaded, ensuring step 4');
            centralizedAuth.setCurrentOnboardingStep(4);
            currentStep = 4;
        }
    });

    $effect(() => {
        // Only sync onboarding completion status
        const newOnboardingComplete = centralizedAuth.isOnboardingCompleted();
        if (newOnboardingComplete !== onboardingComplete) {
            onboardingComplete = newOnboardingComplete;

            // Dispatch complete event only once when onboarding becomes completed
            if (!onboardingComplete && newOnboardingComplete) {
                dispatch('complete');
            }
        }
    });

    onMount(() => {
        // Sync initial state
        currentStep = centralizedAuth.getCurrentOnboardingStep();
        onboardingComplete = centralizedAuth.isOnboardingCompleted();
    });

    let isWaitingForProfile = $state(false);

    // Update isWaitingForProfile based on auth state
    $effect(() => {
        const authState = get(centralizedAuth.getStore());
        const isAuthenticated = authState.isAuthenticated;
        const hasUser = !!authState.user;
        const profileLoaded = authState.profileLoaded;

        const newIsWaitingForProfile = isAuthenticated && hasUser && !profileLoaded && currentStep >= 4;
        console.log('isWaitingForProfile calculation:', {
            isAuthenticated,
            hasUser,
            profileLoaded,
            currentStep,
            currentStepGreaterThan4: currentStep >= 4,
            result: newIsWaitingForProfile
        });

        isWaitingForProfile = newIsWaitingForProfile;
    });

    // Profile loading state management
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

            // Get current auth state from store
            const authState = get(centralizedAuth.getStore());

            // Ensure profile is loaded - try to refresh if needed
            if (!authState.profileLoaded) {
                try {
                    await centralizedAuth.refreshProfile();
                    // Wait for profile loading to complete
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.warn('Profile refresh failed, continuing anyway:', error);
                    // Mark as loaded to prevent infinite loading
                    // Note: This might already be done in refreshProfile, but let's be safe
                }
            }

            // Double-check that we're authenticated
            if (!authState.isAuthenticated) {
                console.warn('handleAuthSuccess called but user not authenticated');
                return;
            }

            // Force step to 4 for profile setup - this should work for all authenticated users
            console.log('Setting onboarding step to 4 for profile setup');
            centralizedAuth.setCurrentOnboardingStep(4);

            // Force local update immediately to ensure UI responds
            currentStep = 4;

            // Force a minimum delay to ensure step change takes effect
            await new Promise(resolve => setTimeout(resolve, 300));

            // Log current state for debugging
            console.log('Auth success - current step:', centralizedAuth.getCurrentOnboardingStep());
            console.log('Local current step:', currentStep);
            console.log('Profile loaded:', authState.profileLoaded);
            console.log('Profile:', authState.profile);

        } catch (error) {
            console.error('Error in handleAuthSuccess:', error);
            // On error, still try to proceed to profile setup
            const currentAuthState = get(centralizedAuth.getStore());
            if (currentAuthState.isAuthenticated) {
                centralizedAuth.setCurrentOnboardingStep(4);
                currentStep = 4; // Force local update
            }
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

    async function handleProfileComplete() {
        console.log('handleProfileComplete called - completing onboarding');
        try {
            // This will refresh the profile from database and mark onboarding as completed
            await centralizedAuth.completeOnboarding();
            console.log('Onboarding completed successfully');
            dispatch('complete');
        } catch (error) {
            console.error('Error completing onboarding:', error);
            // Still dispatch complete to avoid getting stuck
            dispatch('complete');
        }
    }
</script>

<!-- Onboarding content - layout controls when this component is rendered -->
{console.log('Template rendering - onboardingComplete:', onboardingComplete, 'isWaitingForProfile:', isWaitingForProfile, 'currentStep:', currentStep)}
{#if onboardingComplete}
  <!-- Onboarding already complete - don't show anything -->
{:else if isWaitingForProfile}
    <!-- Let GlobalLoading handle this state -->
    {console.log('Showing GlobalLoading because isWaitingForProfile is true')}
  {:else if currentStep === 3}
    <!-- Authentication Step (Step 3) -->
    {console.log('Rendering OnboardingAuth - currentStep:', currentStep)}
    <OnboardingAuth
        on:authSuccess={handleAuthSuccess}
        on:authStart={handleAuthStart}
        on:authError={handleAuthError}
    />
  {:else if currentStep === 4}
    <!-- Profile Setup Step (Step 4) - Show when step is 4, regardless of profile loading status -->
    {console.log('Rendering OnboardingProfile - currentStep:', currentStep)}
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
