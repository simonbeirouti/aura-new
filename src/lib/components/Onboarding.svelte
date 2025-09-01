<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { centralizedAuth } from "../stores/unifiedAuth";
    import OnboardingIntro from "./onboarding/OnboardingIntro.svelte";
    import OnboardingSecurity from "./onboarding/OnboardingSecurity.svelte";
    import OnboardingAuth from "./onboarding/OnboardingAuth.svelte";
    import OnboardingProfile from "./onboarding/OnboardingProfile.svelte";
    import { Button } from "./ui/button";

    const dispatch = createEventDispatcher();

    // Onboarding state - supports 4 steps (intro, security, auth, profile)
    let currentStep = $state(1);
    const totalSteps = 4;
    
    // Check if user is already authenticated on mount
    onMount(() => {
        // If user is already authenticated but hasn't completed onboarding, go to profile step
        if ($centralizedAuth.isAuthenticated && $centralizedAuth.user) {
            // If they have a complete profile, the layout will handle showing the main app
            // via the shouldShowApp derived store, so we don't need to do anything here
            if (!$centralizedAuth.profile || !$centralizedAuth.profile.onboarding_complete) {
                // User is authenticated but needs to complete profile setup
                currentStep = 4;
            }
        }
    });
    
    // Navigation functions
    function nextStep() {
        if (currentStep < totalSteps) {
            currentStep++;
        }
    }

    function prevStep() {
        if (currentStep > 1) {
            currentStep--;
        }
    }

    // Handle authentication success from OnboardingAuth component
    async function handleAuthSuccess() {
        // Wait a moment for the auth store to update with profile data
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check if user has completed onboarding
        if ($centralizedAuth.profile && $centralizedAuth.profile.onboarding_complete) {
            // User has completed onboarding, dispatch completion
            dispatch('complete');
        } else {
            // User needs to complete profile setup
            currentStep = 4;
        }
    }

    // Handle profile setup completion
    function handleProfileComplete() {
        // Profile setup complete, dispatch completion event
        dispatch('complete');
    }
</script>

{#if currentStep === 3}
    <!-- Authentication Step (Step 3) -->
    <OnboardingAuth on:authSuccess={handleAuthSuccess} />
{:else if currentStep === 4}
    <!-- Profile Setup Step (Step 4) -->
    <OnboardingProfile on:complete={handleProfileComplete} />
{:else}
    <!-- Regular Onboarding Layout for Steps 1 & 2 -->
    <div class="min-h-screen bg-background flex flex-col relative">
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

            <!-- Bottom Section: Indicator and Buttons (only for steps 1-2) -->
            {#if currentStep < 3}
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
                            Next
                        </Button>
                    </div>
                </div>
            {/if}
        </div>
    </div>
{/if}
