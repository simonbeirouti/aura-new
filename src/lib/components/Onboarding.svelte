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

    // Onboarding state - supports 3 steps (intro, security, auth)
    // Profile step (4) is separate and not counted in main onboarding
    const totalSteps = 3;

    // Get initial step from sessionStorage
    const getInitialStep = (): number => {
        if (typeof window !== 'undefined') {
            const stored = sessionStorage.getItem('onboardingStep');
            return stored ? parseInt(stored, 10) : 1;
        }
        return 1;
    };

    let currentStep = $state(getInitialStep());
    
    // Track if we're currently attempting authentication to prevent unwanted resets
    let isAuthenticating = $state(false);
    
    // Access derived stores from auth store
    const shouldShowOnboarding = centralizedAuth.shouldShowOnboarding;
    const shouldShowLogin = centralizedAuth.shouldShowLogin;
    
    // Derived visibility logic using Svelte 5 syntax
    const shouldShow = $derived($shouldShowOnboarding || $shouldShowLogin);
    // const isAuthenticated = $derived($centralizedAuth.isAuthenticated);
    // const hasProfile = $derived($centralizedAuth.profile);
    // const onboardingComplete = $derived(hasProfile?.onboarding_complete);
    
    // Check if user is already authenticated on mount
    onMount(() => {
        // If user is already authenticated but hasn't completed onboarding, go to profile step
        if ($centralizedAuth.isAuthenticated && $centralizedAuth.user) {
            // If they have a complete profile, the layout will handle showing the main app
            // via the shouldShowApp derived store, so we don't need to do anything here
            if (!$centralizedAuth.profile || !$centralizedAuth.profile.onboarding_complete) {
                // User is authenticated but needs to complete profile setup
                currentStep = 4;
                // Save to sessionStorage
                if (typeof window !== 'undefined') {
                    sessionStorage.setItem('onboardingStep', currentStep.toString());
                }
            }
        }
        // Don't reset to step 1 on mount - let user stay on current step
    });
    
    // Only handle explicit logout from authenticated state - not auth errors
    let wasAuthenticated = $state(false);

    $effect(() => {
        const isAuth = $centralizedAuth.isAuthenticated;
        const hasUser = !!$centralizedAuth.user;

        // Track authentication state changes
        if (isAuth && hasUser) {
            wasAuthenticated = true;
        }

        // Only reset if user was successfully authenticated and then explicitly logs out from profile step
        // This prevents unwanted resets during authentication failures
        if (!isAuth && !hasUser && wasAuthenticated && currentStep === 4) {
            // Clear sessionStorage when resetting to step 1
            if (typeof window !== 'undefined') {
                sessionStorage.removeItem('onboardingStep');
            }
            currentStep = 1;
            wasAuthenticated = false;
        }
    });
    
    // Derived state to check if we're waiting for profile data
    const isWaitingForProfile = $derived(
        $centralizedAuth.isAuthenticated && 
        $centralizedAuth.user && 
        !$centralizedAuth.profileLoaded
    );
    
    // Use GlobalLoading for profile loading state
    $effect(() => {
        if (isWaitingForProfile) {
            loadingActions.showProfile();
        } else {
            loadingActions.hideProfile();
        }
    });
    
    // Navigation functions
    function nextStep() {
        if (currentStep < totalSteps) {
            currentStep++;
            // Save to sessionStorage to persist across re-initializations
            if (typeof window !== 'undefined') {
                sessionStorage.setItem('onboardingStep', currentStep.toString());
            }
        }
    }

    function prevStep() {
        if (currentStep > 1) {
            currentStep--;
            // Save to sessionStorage to persist across re-initializations
            if (typeof window !== 'undefined') {
                sessionStorage.setItem('onboardingStep', currentStep.toString());
            }
        }
    }

        // Handle authentication success from OnboardingAuth component
    async function handleAuthSuccess() {
        isAuthenticating = false;

        // Wait a moment for the auth store to update with profile data
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check if user has completed onboarding
        if ($centralizedAuth.profile && $centralizedAuth.profile.onboarding_complete) {
            // User has completed onboarding, dispatch completion
            dispatch('complete');
        } else {
            // User needs to complete profile setup
            currentStep = 4;
            // Save to sessionStorage
            if (typeof window !== 'undefined') {
                sessionStorage.setItem('onboardingStep', currentStep.toString());
            }
        }
    }
    
    // Handle authentication start to set the flag
    function handleAuthStart() {
        isAuthenticating = true;
    }
    
    // Handle authentication error to clear the flag
    function handleAuthError() {
        isAuthenticating = false;
    }

    // Handle profile setup completion
    function handleProfileComplete() {
        // Profile setup complete, dispatch completion event
        dispatch('complete');
        // Clear sessionStorage since onboarding is complete
        if (typeof window !== 'undefined') {
            sessionStorage.removeItem('onboardingStep');
        }
    }
</script>

<!-- Only render onboarding if it should be shown -->
{#if shouldShow}
  {#if isWaitingForProfile}
    <!-- Let GlobalLoading handle this state -->
  {:else if currentStep === 3}
    <!-- Authentication Step (Step 3) -->
    <OnboardingAuth 
        on:authSuccess={handleAuthSuccess}
        on:authStart={handleAuthStart}
        on:authError={handleAuthError}
    />
  {:else if currentStep === 4}
    <!-- Profile Setup Step (Step 4) -->
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

            <!-- Bottom Section: Indicator and Buttons (only for steps 1-3) -->
            {#if currentStep <= 3}
                <div class="w-full mx-auto">
                    <!-- Progress Indicator -->
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
{/if}
