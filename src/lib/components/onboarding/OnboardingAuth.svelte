<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from "svelte";
    import { centralizedAuth } from "../../stores/unifiedAuth";
    import { toast } from "svelte-sonner";
    import { Button } from "../ui/button";
    import { Input } from "../ui/input";
    import { Card, CardContent } from "../ui/card";
    import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
    import { loadingStore } from "../../stores/loadingStore";

    const dispatch = createEventDispatcher();

    // Login state
    let email = "";
    let password = "";
    let authMode = "signup"; // "signup" or "login"
    let loginLoading = false;
    let showPassword = false;
    let initialViewportHeight = 0;
    let currentViewportHeight = 0;
    let authCompleted = false; // Track when auth is successfully completed
    let isSwitchingInputs = false; // Track when switching between form inputs

    // Login validation functions
    function isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email.trim());
    }

    function isValidPassword(password: string): boolean {
        return password.trim().length >= 6;
    }

    function validateForm(): string | null {
        const trimmedEmail = email.trim();
        const trimmedPassword = password.trim();

        if (!trimmedEmail) {
            return "Please enter your email address";
        }

        if (!isValidEmail(trimmedEmail)) {
            return "Please enter a valid email address (e.g., test@email.com)";
        }

        if (!trimmedPassword) {
            return "Please enter your password";
        }

        if (!isValidPassword(trimmedPassword)) {
            return "Password must be at least 6 characters long";
        }

        return null;
    }

    // Check if form is valid for button state
    $: isFormValid =
        email.trim() &&
        password.trim() &&
        isValidEmail(email.trim()) &&
        isValidPassword(password.trim());

    function togglePassword() {
        showPassword = !showPassword;
    }

    function handleInputFocus() {
        if (typeof window !== "undefined") {
            // Indicate we're switching between inputs
            isSwitchingInputs = true;

            currentViewportHeight = window.innerHeight;

            // Store the current scroll position
            const currentScrollY = window.scrollY;

            // Adjust viewport meta for better keyboard handling
            const viewportMeta = document.querySelector(
                'meta[name="viewport"]',
            );
            if (viewportMeta) {
                viewportMeta.setAttribute(
                    "content",
                    "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
                );
            }
        }
    }

    function handleInputBlur() {
        if (typeof window !== "undefined") {
            // Indicate we've stopped focusing this input
            isSwitchingInputs = false;

            // Don't reset viewport if auth was just completed - keep keyboard space
            if (authCompleted) {
                return;
            }

            setTimeout(() => {
                // Double-check auth isn't completed and we're not switching inputs
                if (authCompleted || isSwitchingInputs) {
                    return;
                }

                currentViewportHeight = initialViewportHeight;

                // Reset viewport meta tag
                const viewportMeta = document.querySelector(
                    'meta[name="viewport"]',
                );
                if (viewportMeta) {
                    viewportMeta.setAttribute(
                        "content",
                        "width=device-width, initial-scale=1.0",
                    );
                }

                // Ensure we're scrolled to the top
                window.scrollTo({ top: 0, behavior: "smooth" });

                // Force a repaint to ensure proper positioning
                document.body.style.height = "auto";
                setTimeout(() => {
                    document.body.style.height = "";
                }, 50);
            }, 300); // Increased timeout to ensure keyboard is fully dismissed
        }
    }

    function handleViewportResize() {
        if (typeof window !== "undefined") {
            currentViewportHeight = window.innerHeight;

            // Don't reset viewport if auth was completed or we're switching inputs
            if (authCompleted || isSwitchingInputs) {
                return;
            }

            // If viewport is back to initial height, reset any viewport adjustments
            if (currentViewportHeight >= initialViewportHeight * 0.9) {
                // Reset viewport meta tag to ensure proper scaling
                const viewportMeta = document.querySelector(
                    'meta[name="viewport"]',
                );
                if (viewportMeta) {
                    viewportMeta.setAttribute(
                        "content",
                        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
                    );

                    // Force a small delay then reset to allow proper scaling
                    setTimeout(() => {
                        viewportMeta.setAttribute(
                            "content",
                            "width=device-width, initial-scale=1.0",
                        );
                    }, 100);
                }

                // Scroll to top to ensure proper positioning
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        }
    }

    function handleFormSubmit(event: Event) {
        event.preventDefault(); // Prevent any form submission
        handleEmailAuth();
    }

    async function handleEmailAuth() {
        const validationError = validateForm();
        if (validationError) {
            toast.error(validationError);
            return;
        }

        // Show loading immediately and dispatch auth start
        loginLoading = true;
        loadingStore.show({ id: "auth_process" });
        dispatch("authStart");

        try {
            if (authMode === "signup") {
                await centralizedAuth.handleSignUp(
                    email.trim(),
                    password.trim(),
                );
                toast.success(
                    "Account created successfully! Please check your email to verify your account.",
                );
                // Mark auth as completed to prevent viewport reset
                authCompleted = true;

                // Wait a moment for state to settle, then proceed with onboarding
                await new Promise(resolve => setTimeout(resolve, 500));

                // Clean up loading states and dispatch success
                loginLoading = false;
                loadingStore.hide("auth_process");
                dispatch("authSuccess");
            } else {
                await centralizedAuth.handleLogin(
                    email.trim(),
                    password.trim(),
                );
                // Mark auth as completed to prevent viewport reset
                authCompleted = true;

                // Wait at least 1 second for state to settle and prevent flash
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Clean up loading states and dispatch success
                loginLoading = false;
                loadingStore.hide("auth_process");
                dispatch("authSuccess");
            }
                } catch (error) {

            // Clean up loading states
            loginLoading = false;
            loadingStore.hide("auth_process");

            // Extract meaningful error message from Supabase
            let errorMessage = "An unexpected error occurred. Please try again.";

            if (error instanceof Error) {
                const message = error.message.toLowerCase();

                if (message.includes("invalid login credentials") ||
                    message.includes("email not confirmed") ||
                    message.includes("invalid email or password")) {
                    errorMessage = "Email or password is incorrect";
                } else if (message.includes("email already registered") ||
                          message.includes("user already registered")) {
                    errorMessage = "An account with this email already exists";
                } else if (message.includes("password should be at least")) {
                    errorMessage = "Password must be at least 6 characters long";
                } else if (message.includes("invalid email")) {
                    errorMessage = "Please enter a valid email address";
                } else if (message.includes("signup is disabled")) {
                    errorMessage = "Account creation is currently disabled";
                } else if (message.includes("email rate limit")) {
                    errorMessage = "Too many attempts. Please wait before trying again";
                } else {
                    // For other specific errors, show the actual message if it's user-friendly
                    errorMessage = error.message;
                }
            }

            toast.error(errorMessage);
            dispatch("authError");
        } finally {
            loginLoading = false;
            loadingStore.hide("auth_process");
        }
    }

    async function handleAppleSignIn() {
        toast.info("Apple Sign-In coming soon!");
    }

    async function handleFacebookSignIn() {
        toast.info("Facebook Sign-In coming soon!");
    }

    async function handleGoogleSignIn() {
        toast.info("Google Sign-In coming soon!");
    }

    // Lifecycle methods for viewport handling
    onMount(() => {
        if (typeof window !== "undefined") {
            initialViewportHeight = window.innerHeight;
            currentViewportHeight = initialViewportHeight;

            window.addEventListener("resize", handleViewportResize);

            // Add visual viewport support for better mobile handling
            if (window.visualViewport) {
                window.visualViewport.addEventListener(
                    "resize",
                    handleViewportResize,
                );
            }

            // Set initial viewport meta tag
            const viewportMeta = document.querySelector(
                'meta[name="viewport"]',
            );
            if (viewportMeta) {
                viewportMeta.setAttribute(
                    "content",
                    "width=device-width, initial-scale=1.0",
                );
            }

            // Prevent zoom on double tap for iOS
            document.addEventListener(
                "touchstart",
                function (event) {
                    if (event.touches.length > 1) {
                        event.preventDefault();
                    }
                },
                { passive: false },
            );

            let lastTouchEnd = 0;
            document.addEventListener(
                "touchend",
                function (event) {
                    const now = new Date().getTime();
                    if (now - lastTouchEnd <= 300) {
                        event.preventDefault();
                    }
                    lastTouchEnd = now;
                },
                false,
            );
        }
    });

    onDestroy(() => {
        if (typeof window !== "undefined") {
            window.removeEventListener("resize", handleViewportResize);

            // Clean up visual viewport listener
            if (window.visualViewport) {
                window.visualViewport.removeEventListener(
                    "resize",
                    handleViewportResize,
                );
            }

            // Reset viewport meta tag on cleanup
            const viewportMeta = document.querySelector(
                'meta[name="viewport"]',
            );
            if (viewportMeta) {
                viewportMeta.setAttribute(
                    "content",
                    "width=device-width, initial-scale=1.0",
                );
            }

            // Reset auth state on cleanup
            authCompleted = false;
            isSwitchingInputs = false;
        }
    });
</script>

<!-- Full-Screen Login Overlay -->
<div class="min-h-screen flex flex-col safe-area-inset">
    <!-- Main Content Container with Background Image -->
    <Card class="flex-1 relative overflow-hidden mx-3 sm:mx-4 my-3 sm:my-4 shadow-2xl max-h-[70vh] sm:max-h-[75vh] border-0">
        <!-- Background Image -->
        <div class="absolute inset-0 bg-gradient-to-b from-slate-400 via-slate-700 to-slate-900">
            <!-- Robot silhouette overlay -->
            <div class="absolute inset-0 bg-cover bg-center opacity-40" style="background-image: url('/robot.png');"></div>
        </div>

        <!-- Content positioned at bottom of image -->
        <CardContent class="absolute inset-0 flex flex-col justify-end p-4 sm:p-6">
            <!-- Auth Mode Tabs -->
            <div class="flex justify-center mb-4 sm:mb-6">
                <Tabs bind:value={authMode} class="w-3/4 sm:w-1/2 max-w-xs">
                    <TabsList class="grid w-full grid-cols-2 bg-muted/80">
                        <TabsTrigger value="signup" class="text-xs sm:text-sm font-semibold">
                            Sign Up
                        </TabsTrigger>
                        <TabsTrigger value="login" class="text-xs sm:text-sm font-semibold">
                            Log In
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <!-- Form Container -->
            <form class="flex justify-center" on:submit={handleFormSubmit}>
                <div class="w-full max-w-sm px-2">
                    <!-- Email Input -->
                    <div class="mb-3 sm:mb-4">
                        <Input
                            type="email"
                            bind:value={email}
                            placeholder="Email"
                            class="rounded-xl text-sm sm:text-base"
                            disabled={loginLoading}
                            onfocus={handleInputFocus}
                            onblur={handleInputBlur}
                        />
                    </div>

                    <!-- Password Input -->
                    <div class="mb-4 sm:mb-5 relative">
                        <Input
                            type={showPassword ? "text" : "password"}
                            bind:value={password}
                            placeholder="Password"
                            class="rounded-xl text-sm sm:text-base pr-10 sm:pr-12"
                            disabled={loginLoading}
                            onfocus={handleInputFocus}
                            onblur={handleInputBlur}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            class="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            onclick={togglePassword}
                        >
                            {#if showPassword}
                                <svg
                                    class="w-3 h-3 sm:w-4 sm:h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                                    ></path>
                                </svg>
                            {:else}
                                <svg
                                    class="w-3 h-3 sm:w-4 sm:h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                    ></path>
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                    ></path>
                                </svg>
                            {/if}
                        </Button>
                    </div>

                    <!-- Auth Button -->
                    <Button
                        type="submit"
                        disabled={loginLoading || !isFormValid}
                        class="w-full py-3 sm:py-4 text-sm sm:text-base font-semibold rounded-xl"
                        size="lg"
                    >
                        {#if loginLoading}
                            <span class="loading loading-spinner loading-sm sm:loading-md"></span>
                            Loading...
                        {:else}
                            {authMode === "signup" ? "Sign Up" : "Log In"}
                        {/if}
                    </Button>
                </div>
            </form>
        </CardContent>
    </Card>

    <!-- OR ACCESS WITH - Outside the card -->
    <div class="text-center mt-4 sm:mt-6 mb-4 sm:mb-6">
        <p class="text-muted-foreground text-xs font-medium tracking-wide">
            OR ACCESS WITH
        </p>
    </div>

    <!-- Social Login Buttons - Outside the card -->
    <div class="flex justify-center gap-4 sm:gap-5 mb-4 sm:mb-6 pb-safe">
        <Button
            variant="outline"
            size="icon"
            onclick={handleAppleSignIn}
            class="rounded-full w-12 h-12 sm:w-14 sm:h-14 shadow-sm"
            aria-label="Sign in with Apple"
        >
            <svg
                class="w-5 h-5 sm:w-6 sm:h-6"
                viewBox="0 0 24 24"
                fill="currentColor"
            >
                <path
                    d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
                />
            </svg>
        </Button>

        <Button
            variant="outline"
            size="icon"
            onclick={handleFacebookSignIn}
            class="rounded-full w-12 h-12 sm:w-14 sm:h-14 shadow-sm"
            aria-label="Sign in with Facebook"
        >
            <svg
                class="w-5 h-5 sm:w-6 sm:h-6 text-[#1877F2]"
                viewBox="0 0 24 24"
                fill="currentColor"
            >
                <path
                    d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
                />
            </svg>
        </Button>

        <Button
            variant="outline"
            size="icon"
            onclick={handleGoogleSignIn}
            class="rounded-full w-12 h-12 sm:w-14 sm:h-14 shadow-sm"
            aria-label="Sign in with Google"
        >
            <svg class="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24">
                <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
            </svg>
        </Button>
    </div>
</div>
