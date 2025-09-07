<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { get } from "svelte/store";
    import { centralizedAuth } from "../../stores/unifiedAuth";
    import { dataStore } from "../../stores/dataStore";
    import {
        uploadAvatar,
        validateImageFile,
        createFilePreview,
    } from "../../utils/storage";
    import {
        CameraIcon,
        LoaderIcon,
    } from "lucide-svelte";
    import { toast } from "svelte-sonner";
    import { Button } from "../ui/button";
    import { Input } from "../ui/input";
    import { Badge } from "../ui/badge";
    import { loadingActions } from "../../stores/loadingStore";

    const dispatch = createEventDispatcher();

    // UI state
    let isSaving = false;
    let isUploading = false;
    let avatarPreview = "";
    let isLoading = true;
    let loadingError: string | null = null;

    // Profile form data (for authenticated users)
    let profileData = {
        full_name: "",
        username: "",
        avatar_url: "",
    };

    // File input reference
    let fileInput: HTMLInputElement;

    // Initialize profile data when component mounts
    onMount(async () => {
        loadingActions.showProfile();
        
        try {
            const authState = get(centralizedAuth.getStore());
            if (authState.user) {
                // Initialize from user metadata if available
                profileData.full_name = authState.user.user_metadata?.full_name || "";
                profileData.avatar_url = authState.user.user_metadata?.avatar_url || "";

                // Try to load existing profile data
                try {
                    const existingProfile = await dataStore.getUserProfile(authState.user.id);
                    if (existingProfile) {
                        profileData.full_name = existingProfile.full_name || profileData.full_name;
                        profileData.username = existingProfile.username || "";
                        profileData.avatar_url = existingProfile.avatar_url || profileData.avatar_url;
                    }
                } catch (error) {
                    // No existing profile found, will start with fresh data
                }
                
                // Set avatar preview if we have an avatar URL
                if (profileData.avatar_url) {
                    avatarPreview = profileData.avatar_url;
                }
            }
        } catch (error) {
            loadingError = error instanceof Error ? error.message : "Failed to load profile data";
        } finally {
            isLoading = false;
            loadingActions.hideProfile();
        }
    });

    async function handleAvatarUpload(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];

        const authState = get(centralizedAuth.getStore());
        if (!file || !authState.user) return;

        try {
            // Validate file
            const validation = validateImageFile(file);
            if (!validation.valid) {
                throw new Error(validation.error || "Invalid file");
            }

            // Create preview
            avatarPreview = await createFilePreview(file);

            // Upload to storage
            isUploading = true;

            const result = await uploadAvatar(file, authState.user.id);
            if (result.success && result.publicUrl) {
                profileData.avatar_url = result.publicUrl;
                
                // Test if the URL is accessible by trying to load it
                if (result.publicUrl) {
                    try {
                        const img = new Image();
                        img.onload = () => {
                            avatarPreview = result.publicUrl!;
                        };
                        img.onerror = () => {
                            // Keep the local preview for now, but try again after a delay
                            setTimeout(() => {
                                avatarPreview = result.publicUrl!;
                            }, 2000);
                        };
                        img.src = result.publicUrl;
                    } catch (imageError) {
                        // Keep the local preview
                    }
                }
            } else {
                throw new Error(result.error || "Upload failed");
            }
        } catch (error) {
            const errorMessage = error instanceof Error
                ? error.message
                : "Failed to upload avatar";
            toast.error(errorMessage);
            avatarPreview = "";
        } finally {
            isUploading = false;
        }
    }

    function triggerFileInput() {
        fileInput?.click();
    }

    async function checkUsername() {
        if (!profileData.username || profileData.username.length < 3) {
            toast.error("Username must be at least 3 characters");
            return false;
        }

        try {
            const isAvailable = await dataStore.checkUsernameAvailability(
                profileData.username,
            );
            if (!isAvailable) {
                toast.error("Username is already taken");
                return false;
            }
            return true;
        } catch (error) {
            toast.error("Failed to check username availability");
            return false;
        }
    }

    // Reset view to handle keyboard displacement
    function resetView() {
        // Blur any focused input to dismiss keyboard
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        
        // Scroll to top and reset viewport
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        // Force viewport reset for mobile browsers
        if (typeof window !== 'undefined') {
            // Small delay to ensure keyboard is dismissed
            setTimeout(() => {
                window.scrollTo({ top: 0, behavior: 'auto' });
                // Trigger a resize event to reset the viewport
                window.dispatchEvent(new Event('resize'));
            }, 100);
        }
    }

    async function completeOnboarding(isSkipped = false) {
        console.log('completeOnboarding called with isSkipped:', isSkipped);

        const authState = get(centralizedAuth.getStore());

        if (!authState?.user) {
            console.log('No authenticated user found, cannot complete onboarding');
            return;
        }

        const userId = authState.user.id;
        const userEmail = authState.user.email;
        console.log('Starting onboarding completion for user:', userId);
        isSaving = true;

        try {
            // Create or update user profile
            const profilePayload = {
                full_name: profileData.full_name || userEmail || "",
                username: profileData.username || "",
                avatar_url: profileData.avatar_url || "",
                onboarding_complete: true,
            };

            console.log('Creating/updating profile with payload:', profilePayload);

            // Try to get existing profile first
            let existingProfile = null;
            try {
                console.log('Fetching existing profile for user:', userId);
                existingProfile = await dataStore.getUserProfile(userId);
                console.log('Existing profile found:', existingProfile);
            } catch (error) {
                console.log('No existing profile found, will create new one. Error:', error);
                // No existing profile found, will create new one
            }

            let updatedProfile;
            if (existingProfile) {
                // Update existing profile
                console.log('Updating existing profile:', existingProfile);
                console.log('Update payload:', {
                    full_name: profilePayload.full_name,
                    username: profilePayload.username,
                    avatar_url: profilePayload.avatar_url,
                    onboarding_complete: profilePayload.onboarding_complete,
                });
                try {
                    updatedProfile = await dataStore.updateUserProfile(userId, {
                        full_name: profilePayload.full_name,
                        username: profilePayload.username,
                        avatar_url: profilePayload.avatar_url,
                        onboarding_complete: profilePayload.onboarding_complete,
                    });
                    console.log('Profile updated successfully:', updatedProfile);
                    console.log('Onboarding complete status in updated profile:', updatedProfile?.onboarding_complete);
                } catch (updateError) {
                    console.error('Profile update failed:', updateError);
                    throw updateError;
                }
            } else {
                // Create new profile
                console.log('Creating new profile with payload:', {
                    full_name: profilePayload.full_name,
                    username: profilePayload.username,
                    avatar_url: profilePayload.avatar_url,
                    onboarding_complete: profilePayload.onboarding_complete,
                });
                try {
                    updatedProfile = await dataStore.createUserProfile(userId, {
                        full_name: profilePayload.full_name,
                        username: profilePayload.username,
                        avatar_url: profilePayload.avatar_url,
                        onboarding_complete: profilePayload.onboarding_complete,
                    });
                    console.log('Profile created successfully:', updatedProfile);
                    console.log('Onboarding complete status in created profile:', updatedProfile?.onboarding_complete);
                } catch (createError) {
                    console.error('Profile creation failed:', createError);
                    throw createError;
                }
            }

            // Update the profile in the store directly instead of relying on refresh
            console.log('Updating profile in auth store directly');
            const authState = get(centralizedAuth.getStore());
            console.log('Current profile in store:', authState.profile);
            console.log('Update payload:', profilePayload);

            const updatedProfileInStore = {
                ...authState.profile,
                ...profilePayload,
                updated_at: new Date().toISOString()
            };

            console.log('Updated profile object:', updatedProfileInStore);

            // Update the auth store directly
            centralizedAuth.getStore().update(state => ({
                ...state,
                profile: updatedProfileInStore,
                profileLoaded: true
            }));

            console.log('Profile updated in store:', updatedProfileInStore);

            // Also try to refresh from database as backup
            try {
                await centralizedAuth.refreshProfile();
                console.log('Profile refresh completed as backup');
            } catch (refreshError) {
                console.warn('Profile refresh failed, but store was updated directly:', refreshError);
            }

            // Clear form data
            profileData.full_name = "";
            profileData.username = "";
            profileData.avatar_url = "";
            avatarPreview = "";

            // Reset view before dispatching completion
            resetView();

            // Show success message before dispatching completion
            toast.success("Profile setup complete! Welcome to Aura.");

            // Wait longer to ensure database transaction is fully committed
            setTimeout(() => {
                // Dispatch completion event
                dispatch("complete", {
                    skipped: isSkipped,
                    profile: profilePayload,
                });
            }, 1500); // Increased delay to ensure database commit
            
        } catch (error) {
            // Reset view even on error
            resetView();

            // Show error message
            toast.error("There was an issue saving your profile. Continuing anyway...");

            // Still dispatch completion to avoid getting stuck
            setTimeout(() => {
                dispatch("complete", {
                    skipped: true,
                    error: error instanceof Error ? error.message : "Unknown error",
                });
            }, 500); // Give user time to see error message
        } finally {
            isSaving = false;
        }
    }
</script>

<!-- Full Screen Profile Setup Layout -->
<div class="min-h-screen bg-background flex flex-col overflow-hidden">
    {#if isLoading}
        <!-- Let GlobalLoading handle this state -->
        {#if loadingError}
            <div class="flex-1 flex flex-col items-center justify-center px-6">
                <div class="text-center max-w-sm">
                    <div class="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <p class="text-sm text-destructive">{loadingError}</p>
                    </div>
                </div>
            </div>
        {/if}
    {:else}
    <!-- Header Section -->
    <div class="flex flex-col items-center text-center pt-8 pb-4 px-6">
        <div class="flex justify-center mb-2">
            <Badge variant="secondary" class="px-3 py-1 text-sm">
                Final Step
            </Badge>
        </div>
        <h1 class="text-3xl font-bold mb-2 text-foreground">
            Set up your profile
        </h1>
        <p class="text-lg text-muted-foreground leading-relaxed max-w-sm">
            Tell us a bit about yourself to personalize your experience
        </p>
    </div>

    <!-- Main Content Section -->
    <div class="flex-1 flex flex-col items-center justify-center px-6 pb-48">
        <div class="w-full max-w-sm space-y-6">
            <!-- Avatar Upload -->
            <div class="flex flex-col items-center gap-2">
                <Button
                    variant="outline"
                    class="w-36 h-36 rounded-full border-2 border-dashed hover:border-primary transition-colors p-0 overflow-hidden"
                    onclick={triggerFileInput}
                    disabled={isUploading}
                >
                    {#if avatarPreview}
                        <img
                            src={avatarPreview}
                            alt="Avatar preview"
                            class="w-full h-full object-cover"
                        />
                    {:else if isUploading}
                        <LoaderIcon class="w-5 h-5 animate-spin text-primary" />
                    {:else}
                        <div class="flex flex-col items-center gap-1">
                            <CameraIcon class="w-5 h-5 text-muted-foreground" />
                            <span class="text-xs text-muted-foreground">Add Photo</span>
                        </div>
                    {/if}
                </Button>
                <p class="text-sm text-muted-foreground text-center">
                    Click to add a profile photo
                </p>
            </div>

            <!-- File Input -->
            <input
                bind:this={fileInput}
                type="file"
                accept="image/*"
                class="hidden"
                onchange={handleAvatarUpload}
            />

            <!-- Form Fields -->
            <div class="space-y-4">
                <!-- Full Name -->
                <div class="space-y-1">
                    <Input
                        id="full-name-input"
                        type="text"
                        bind:value={profileData.full_name}
                        placeholder="Enter your full name"
                        class="h-11 text-base"
                        required
                    />
                </div>

                <!-- Username -->
                <div class="space-y-1">
                    <Input
                        id="username-input"
                        type="text"
                        bind:value={profileData.username}
                        placeholder="Choose a username"
                        onblur={checkUsername}
                        class="h-11 text-base"
                        required
                    />
                </div>
            </div>

        </div>
    </div>

    <!-- Fixed Bottom Button -->
    <div class="fixed bottom-0 left-0 right-0 p-6 bg-background/95 backdrop-blur-sm">
        <div class="w-full max-w-sm mx-auto">
            <Button
                onclick={() => completeOnboarding(false)}
                disabled={isSaving ||
                    !profileData.full_name ||
                    !profileData.username}
                size="lg"
                class="w-full h-11 text-base font-medium"
            >
                {#if isSaving}
                    <LoaderIcon class="w-4 h-4 animate-spin mr-2" />
                    Creating...
                {:else}
                    Complete Setup
                {/if}
            </Button>
        </div>
    </div>
    {/if}
</div>
