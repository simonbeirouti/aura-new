<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
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
    import { Button } from "../ui/button";
    import { Input } from "../ui/input";
    import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
    import { Badge } from "../ui/badge";

    const dispatch = createEventDispatcher();

    // UI state
    let isSaving = false;
    let isUploading = false;
    let uploadError = "";
    let usernameError = "";
    let avatarPreview = "";

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
        if ($centralizedAuth.user) {
            // Initialize from user metadata if available
            profileData.full_name = $centralizedAuth.user.user_metadata?.full_name || "";
            profileData.avatar_url = $centralizedAuth.user.user_metadata?.avatar_url || "";
            
            // Try to load existing profile data
            try {
                const existingProfile = await dataStore.getUserProfile($centralizedAuth.user.id);
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
    });

    async function handleAvatarUpload(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];

        if (!file || !$centralizedAuth.user) return;

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
            uploadError = "";

            const result = await uploadAvatar(file, $centralizedAuth.user.id);
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
            uploadError =
                error instanceof Error
                    ? error.message
                    : "Failed to upload avatar";
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
            usernameError = "Username must be at least 3 characters";
            return false;
        }

        try {
            const isAvailable = await dataStore.checkUsernameAvailability(
                profileData.username,
            );
            if (!isAvailable) {
                usernameError = "Username is already taken";
                return false;
            }
            usernameError = "";
            return true;
        } catch (error) {
            usernameError = "Failed to check username availability";
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
        if (!$centralizedAuth.user) {
            console.error("No authenticated user found");
            return;
        }

        isSaving = true;

        try {
            // Create or update user profile
            const profilePayload = {
                full_name: profileData.full_name || $centralizedAuth.user.email || "",
                username: profileData.username || "",
                avatar_url: profileData.avatar_url || "",
                onboarding_complete: true,
            };

            // Try to get existing profile first
            let existingProfile = null;
            try {
                existingProfile = await dataStore.getUserProfile(
                    $centralizedAuth.user.id,
                );
            } catch (error) {
                // No existing profile found, will create new one
            }

            if (existingProfile) {
                // Update existing profile
                await dataStore.updateUserProfile($centralizedAuth.user.id, {
                    full_name: profilePayload.full_name,
                    username: profilePayload.username,
                    avatar_url: profilePayload.avatar_url,
                    onboarding_complete: profilePayload.onboarding_complete,
                });
            } else {
                // Create new profile
                await dataStore.createUserProfile($centralizedAuth.user.id, {
                    full_name: profilePayload.full_name,
                    username: profilePayload.username,
                    avatar_url: profilePayload.avatar_url,
                    onboarding_complete: profilePayload.onboarding_complete,
                });
            }

            // Reset view before dispatching completion
            resetView();

            // Small delay to ensure view reset completes before transition
            setTimeout(() => {
                // Dispatch completion event
                dispatch("complete", {
                    skipped: isSkipped,
                    profile: profilePayload,
                });
            }, 150);
            
        } catch (error) {
            // Reset view even on error
            resetView();
            
            // Still dispatch completion to avoid getting stuck
            setTimeout(() => {
                dispatch("complete", {
                    skipped: true,
                    error: error instanceof Error ? error.message : "Unknown error",
                });
            }, 150);
        } finally {
            isSaving = false;
        }
    }
</script>

<!-- Profile Setup Layout matching steps 1 & 2 -->
<div class="min-h-screen bg-background flex flex-col relative">
    <!-- Main Content Container -->
    <div class="flex-1 flex flex-col justify-between items-center px-8 py-16">
        <!-- Top Section: Profile Form -->
        <div class="flex-1 flex flex-col justify-center items-center max-w-md mx-auto">
            <Card class="w-full max-w-lg border-0 shadow-lg bg-card/50 backdrop-blur-sm">
                <CardHeader class="text-center pb-6">
                    <div class="flex justify-center mb-2">
                        <Badge variant="secondary" class="px-3 py-1">
                            Final Step
                        </Badge>
                    </div>
                    <CardTitle class="text-3xl font-bold">
                        Set up your profile
                    </CardTitle>
                    <CardDescription class="text-lg leading-relaxed">
                        Tell us a bit about yourself to personalize your experience
                    </CardDescription>
                </CardHeader>
                <CardContent class="space-y-6">

                    <!-- Avatar Upload -->
                    <div class="flex flex-col items-center gap-4">
                        <Button
                            variant="outline"
                            class="w-32 h-32 rounded-full border-2 border-dashed hover:border-primary transition-colors p-0 overflow-hidden"
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
                                <LoaderIcon class="w-8 h-8 animate-spin text-primary" />
                            {:else}
                                <div class="flex flex-col items-center gap-2">
                                    <CameraIcon class="w-8 h-8 text-muted-foreground" />
                                    <span class="text-xs text-muted-foreground">Add Photo</span>
                                </div>
                            {/if}
                        </Button>
                        <p class="text-xs text-muted-foreground text-center">
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
                        <div class="space-y-2">
                            <Input
                                id="full-name-input"
                                type="text"
                                bind:value={profileData.full_name}
                                placeholder="Enter your full name"
                                required
                            />
                        </div>

                        <!-- Username -->
                        <div class="space-y-2">
                            <Input
                                id="username-input"
                                type="text"
                                bind:value={profileData.username}
                                placeholder="Choose a username"
                                onblur={checkUsername}
                                class={usernameError ? 'border-destructive' : ''}
                                required
                            />
                            {#if usernameError}
                                <div class="text-sm text-destructive mt-1">
                                    {usernameError}
                                </div>
                            {/if}
                        </div>
                    </div>

                    {#if uploadError}
                        <Card class="border-destructive bg-destructive/10">
                            <CardContent class="p-3">
                                <p class="text-sm text-destructive">{uploadError}</p>
                            </CardContent>
                        </Card>
                    {/if}
                </CardContent>
            </Card>
        </div>

        <!-- Bottom Section: Complete Setup Button (aligned with steps 1-2) -->
        <div class="w-full mx-auto">
            <div class="flex justify-center items-center px-2 pb-12">
                <Button
                    onclick={() => completeOnboarding(false)}
                    disabled={isSaving ||
                        !profileData.full_name ||
                        !profileData.username ||
                        !!usernameError}
                    size="lg"
                    class="px-8"
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
    </div>
</div>
