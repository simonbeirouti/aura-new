<script lang="ts">
  import { onMount } from "svelte";
  import AppLayout from "$lib/components/AppLayout.svelte";
  import { goto } from "$app/navigation";
  import {
    biometricActions,
    isBiometricAvailable,
    isBiometricEnabled,
  } from "$lib/stores/biometricStore";
  import {
    notificationSettings,
    notificationActions,
  } from "$lib/stores/notificationStore";
  import { Switch } from "$lib/components/ui/switch";
  import { toast } from "svelte-sonner";


  onMount(async () => {
    // Initialize biometric store if not already done
    await biometricActions.initialize();
    // Initialize notification settings
    await notificationSettings.initialize();
    // Initialize notification listeners
    await notificationActions.initializeListeners();
  });

  function goBack() {
    goto("/settings");
  }

  async function handleToggleBiometric() {
    if (!$isBiometricAvailable) {
      toast.error("Biometric authentication is not available on this device");
      return;
    }

    try {
      const newEnabled = !$isBiometricEnabled;
      // When enabling biometric, also require it on startup for security
      await biometricActions.setEnabled(newEnabled, newEnabled);

      if (newEnabled) {
        toast.success("Biometric authentication enabled - will be required on app startup");
      } else {
        toast.success("Biometric authentication disabled");
      }
    } catch (error) {
      toast.error("Failed to update biometric settings");
    }
  }

  async function handleToggleNotifications() {
    try {
      const newEnabled = !$notificationSettings.enabled;

      if (newEnabled) {
        // Request permission when enabling
        const granted = await notificationActions.requestPermission();
        if (!granted) {
          toast.error("Notification permission denied");
          return;
        }
      }

      await notificationSettings.updateSettings({ enabled: newEnabled });

      toast.success(`Notifications ${newEnabled ? "enabled" : "disabled"}`);
    } catch (error) {
      toast.error("Failed to update notification settings");
    }
  }

</script>

<AppLayout
  title="Security"
  showBackButton={true}
  onBack={goBack}
  maxWidth="max-w-2xl"
>
  <div class="flex items-center justify-between py-4">
    <h1 class="text-sm font-medium">Biometric Authentication</h1>
    <Switch
      checked={$isBiometricEnabled}
      disabled={!$isBiometricAvailable}
      onCheckedChange={handleToggleBiometric}
    />
  </div>
  <!-- Enable Notifications -->
  <div class="flex items-center justify-between py-4">
    <h1 class="text-sm font-medium">Enable Notifications</h1>
    <Switch
      checked={$notificationSettings.enabled}
      onCheckedChange={handleToggleNotifications}
    />
  </div>

</AppLayout>
